mod auth;
mod db;
mod error;
mod handlers;
mod state;
mod ws;

use axum::{
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use axum::http::{header::{AUTHORIZATION, ACCEPT, CONTENT_TYPE}, Method};
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::state::AppState;

/// Health check endpoint for load balancers
async fn health_check() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// Readiness check - verifies database connection
async fn readiness_check(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "status": "ready",
                "database": "connected"
            })),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "not_ready",
                "database": "disconnected"
            })),
        ),
    }
}

#[tokio::main]
async fn main() {
    // Load .env from current directory (or set DATABASE_URL etc. in the environment for production)
    dotenvy::dotenv().ok();

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gather_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Bind to port FIRST so Render (and other PaaS) detect an open port immediately.
    // Then we connect to DB and start serving.
    let bind_addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {}: {}", bind_addr, e));
    tracing::info!("Bound to {} (connecting to database...)", bind_addr);

    // DATABASE_URL: from .env in apps/server or from environment (env overrides .env)
    let mut database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set (e.g. in .env or environment)");
    // Cloud Postgres (Render, etc.) requires SSL. Add sslmode=require only for non-localhost.
    if !database_url.contains("sslmode=") {
        let is_local = database_url.contains("@localhost") || database_url.contains("@127.0.0.1");
        if !is_local {
            let sep = if database_url.contains('?') { "&" } else { "?" };
            database_url.push_str(&format!("{}sslmode=require", sep));
        }
    }
    let cors_origin = std::env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".to_string());

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(30))
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    tracing::info!("Running migrations...");
    db::run_migrations(&pool).await.expect("Failed to run migrations");

    let state = Arc::new(AppState::new(pool));

    let cors_origin = std::env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".to_string());

    let origins: Vec<axum::http::HeaderValue> = cors_origin
        .split(',')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                s.parse().ok()
            }
        })
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers([AUTHORIZATION, ACCEPT, CONTENT_TYPE])
        .allow_credentials(true);

    let governor_conf = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(100)
        .finish()
        .expect("Failed to create rate limiter config");
    let governor_layer = GovernorLayer {
        config: Arc::new(governor_conf),
    };

    let api_routes = Router::new()
        .route("/auth/guest", post(handlers::auth::create_guest))
        .route("/dev/seed", post(handlers::dev::seed))
        .route("/spaces", get(handlers::spaces::list_spaces))
        .route("/spaces/:id", get(handlers::spaces::get_space))
        .route("/chat/:space_id", get(handlers::chat::get_messages))
        .layer(governor_layer);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/ready", get(readiness_check))
        .nest("/api", api_routes)
        .route("/ws", get(ws::ws_handler))
        .layer(cors)
        .with_state(state);

    tracing::info!("Server listening on http://0.0.0.0:{}", port);

    // Graceful shutdown handling
    // Use IntoMakeServiceWithConnectInfo to provide client IP for rate limiting
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("Server error");

    tracing::info!("Server shut down gracefully");
}

/// Handle shutdown signals for graceful shutdown
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            tracing::info!("Received Ctrl+C, starting graceful shutdown...");
        }
        _ = terminate => {
            tracing::info!("Received SIGTERM, starting graceful shutdown...");
        }
    }
}
