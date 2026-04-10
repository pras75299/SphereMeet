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

    let pool = PgPoolOptions::new()
        .max_connections(10)
        // 15 s acquire_timeout: generous enough for remote Render Postgres to
        // establish a fresh connection (~3-8 s), yet still under the frontend's
        // 25 s abort so the server returns a proper 500 before the client gives up.
        .acquire_timeout(Duration::from_secs(15))
        .connect(&database_url)
        .await
        .unwrap_or_else(|e| {
            eprintln!("FATAL: Cannot connect to database at configured DATABASE_URL: {}", e);
            eprintln!("Check that the database is running and DATABASE_URL is correct.");
            std::process::exit(1);
        });

    tracing::info!("Running migrations...");
    db::run_migrations(&pool).await.unwrap_or_else(|e| {
        eprintln!("FATAL: Database migration failed: {}", e);
        std::process::exit(1);
    });

    match db::ensure_main_office(&pool).await {
        Ok(id) => tracing::info!(space_id = %id, "Main Office ready"),
        Err(e) => tracing::warn!("Could not ensure Main Office (non-fatal, spaces still listable): {:?}", e),
    }

    match db::ensure_demo_users(&pool).await {
        Ok(()) => tracing::info!("Demo users ready"),
        Err(e) => tracing::warn!("Could not seed demo users (non-fatal): {:?}", e),
    }

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
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/guest", post(handlers::auth::create_guest))
        .route("/dev/seed", post(handlers::dev::seed))
        .route("/spaces", get(handlers::spaces::list_spaces).post(handlers::spaces::create_space))
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
