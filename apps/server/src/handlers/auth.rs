use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::create_token;
use crate::db;
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateGuestRequest {
    pub display_name: String,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
pub struct CreateGuestResponse {
    pub token: String,
    pub user: UserResponse,
}

pub async fn create_guest(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateGuestRequest>,
) -> AppResult<Json<CreateGuestResponse>> {
    let display_name = payload.display_name.trim();
    if display_name.is_empty() || display_name.len() > 50 {
        return Err(crate::error::AppError::BadRequest(
            "Display name must be 1-50 characters".to_string(),
        ));
    }

    let user = db::create_user(&state.pool, display_name).await?;
    let token = create_token(user.id, &user.display_name)?;

    Ok(Json(CreateGuestResponse {
        token,
        user: UserResponse {
            id: user.id,
            display_name: user.display_name,
        },
    }))
}
