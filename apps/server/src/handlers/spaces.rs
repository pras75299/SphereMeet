use axum::{
    extract::{Path, State},
    Json,
};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct SpaceListItem {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct MapResponse {
    pub id: Uuid,
    pub name: Option<String>,
    pub width: i32,
    pub height: i32,
    pub tiles: serde_json::Value,
    pub blocked: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct ZoneResponse {
    pub id: Uuid,
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Serialize)]
pub struct SpaceDetailResponse {
    pub space: SpaceListItem,
    pub map: Option<MapResponse>,
    pub zones: Vec<ZoneResponse>,
}

pub async fn list_spaces(
    _auth: AuthUser, // Require authentication
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Vec<SpaceListItem>>> {
    let spaces = db::list_spaces(&state.pool).await?;
    let items: Vec<SpaceListItem> = spaces
        .into_iter()
        .map(|s| SpaceListItem {
            id: s.id,
            name: s.name,
        })
        .collect();

    Ok(Json(items))
}

pub async fn get_space(
    _auth: AuthUser, // Require authentication
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SpaceDetailResponse>> {
    let space = db::get_space(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Space not found".to_string()))?;

    let map = db::get_map_for_space(&state.pool, id).await?;
    let zones = db::get_zones_for_space(&state.pool, id).await?;

    let response = SpaceDetailResponse {
        space: SpaceListItem {
            id: space.id,
            name: space.name,
        },
        map: map.map(|m| MapResponse {
            id: m.id,
            name: m.name,
            width: m.width,
            height: m.height,
            tiles: m.tiles,
            blocked: m.blocked,
        }),
        zones: zones
            .into_iter()
            .map(|z| ZoneResponse {
                id: z.id,
                name: z.name,
                x: z.x,
                y: z.y,
                w: z.w,
                h: z.h,
            })
            .collect(),
    };

    Ok(Json(response))
}
