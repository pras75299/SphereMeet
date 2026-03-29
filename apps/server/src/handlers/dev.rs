use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::db;
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct SeedResponse {
    pub space_id: Uuid,
}

/// Idempotent: ensures Main Office + map + zones (same as server startup). Works in all environments.
pub async fn seed(State(state): State<Arc<AppState>>) -> AppResult<Json<SeedResponse>> {
    let space_id = db::ensure_main_office(&state.pool).await?;
    Ok(Json(SeedResponse { space_id }))
}
