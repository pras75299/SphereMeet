use axum::{extract::State, Json};
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct SeedResponse {
    pub space_id: Uuid,
}

/// Check if we're in development mode
fn is_dev_mode() -> bool {
    std::env::var("RUST_ENV")
        .map(|v| v != "production")
        .unwrap_or(true)
}

pub async fn seed(State(state): State<Arc<AppState>>) -> AppResult<Json<SeedResponse>> {
    // Only allow seeding in development mode
    if !is_dev_mode() {
        return Err(AppError::BadRequest(
            "Seed endpoint is only available in development mode".to_string(),
        ));
    }
    
    const DEMO_SPACE_NAME: &str = "Main Office";
    // Return existing "Main Office" if present, so we never create duplicates (e.g. from double-click)
    if let Some(existing) = db::get_space_by_name(&state.pool, DEMO_SPACE_NAME).await? {
        return Ok(Json(SeedResponse { space_id: existing.id }));
    }
    let space = db::create_space(&state.pool, DEMO_SPACE_NAME).await?;

    // Create a 20x15 map
    let width = 20;
    let height = 15;
    let tile_count = width * height;

    // Create tiles array (all floor tiles = 1)
    let tiles: Vec<i32> = vec![1; tile_count as usize];

    // Create blocked tiles (walls around the edges)
    let mut blocked: Vec<i32> = Vec::new();
    for y in 0..height {
        for x in 0..width {
            // Block edges
            if x == 0 || x == width - 1 || y == 0 || y == height - 1 {
                blocked.push(y * width + x);
            }
        }
    }

    db::create_map(
        &state.pool,
        space.id,
        Some("Office Floor"),
        width,
        height,
        json!(tiles),
        json!(blocked),
    )
    .await?;

    // Create zones
    db::create_zone(&state.pool, space.id, Some("Meeting Room A"), 2, 2, 4, 4).await?;
    db::create_zone(&state.pool, space.id, Some("Meeting Room B"), 14, 2, 4, 4).await?;
    db::create_zone(&state.pool, space.id, Some("Lounge"), 8, 8, 4, 4).await?;
    db::create_zone(&state.pool, space.id, Some("Kitchen"), 2, 9, 4, 4).await?;

    Ok(Json(SeedResponse { space_id: space.id }))
}
