mod auth;
mod db;
mod error;
mod handlers;
mod state;
mod ws;

use axum::{
    routing::{get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::state::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gather_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let cors_origin = std::env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".to_string());

    tracing::info!("Connecting to database...");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(30))
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Run migrations
    tracing::info!("Running migrations...");
    db::run_migrations(&pool).await.expect("Failed to run migrations");
    tracing::info!("Migrations complete");

    let state = Arc::new(AppState::new(pool));

    let cors = CorsLayer::new()
        .allow_origin(cors_origin.parse::<axum::http::HeaderValue>().unwrap())
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Auth
        .route("/api/auth/guest", post(handlers::auth::create_guest))
        // Dev
        .route("/api/dev/seed", post(handlers::dev::seed))
        // Spaces
        .route("/api/spaces", get(handlers::spaces::list_spaces))
        .route("/api/spaces/:id", get(handlers::spaces::get_space))
        // Chat
        .route("/api/chat/:space_id", get(handlers::chat::get_messages))
        // WebSocket
        .route("/ws", get(ws::ws_handler))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .expect("Failed to bind to port 8080");

    tracing::info!("Server listening on http://localhost:8080");

    axum::serve(listener, app).await.expect("Server error");
}
