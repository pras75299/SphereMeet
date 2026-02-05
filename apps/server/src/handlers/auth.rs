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
    tracing::info!("create_guest called with display_name: {}", payload.display_name);
    
    let display_name = payload.display_name.trim();
    if display_name.is_empty() || display_name.len() > 50 {
        return Err(crate::error::AppError::BadRequest(
            "Display name must be 1-50 characters".to_string(),
        ));
    }

    tracing::info!("Creating user in database...");
    let user = db::create_user(&state.pool, display_name).await?;
    tracing::info!("User created with id: {}", user.id);
    
    tracing::info!("Creating JWT token...");
    let token = match create_token(user.id, &user.display_name) {
        Ok(t) => {
            tracing::info!("Token created successfully");
            t
        }
        Err(e) => {
            tracing::error!("Failed to create token: {:?}", e);
            return Err(e);
        }
    };

    Ok(Json(CreateGuestResponse {
        token,
        user: UserResponse {
            id: user.id,
            display_name: user.display_name,
        },
    }))
}
