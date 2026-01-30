use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::db;
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct GetMessagesQuery {
    pub channel: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ChatMessageResponse {
    pub id: Uuid,
    pub channel: String,
    pub user_id: Uuid,
    pub display_name: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

pub async fn get_messages(
    State(state): State<Arc<AppState>>,
    Path(space_id): Path<Uuid>,
    Query(query): Query<GetMessagesQuery>,
) -> AppResult<Json<Vec<ChatMessageResponse>>> {
    let channel = query.channel.unwrap_or_else(|| "general".to_string());

    let messages = db::get_chat_messages(&state.pool, space_id, &channel, 50).await?;

    let response: Vec<ChatMessageResponse> = messages
        .into_iter()
        .map(|m| ChatMessageResponse {
            id: m.id,
            channel: m.channel,
            user_id: m.user_id,
            display_name: m.display_name,
            body: m.body,
            created_at: m.created_at,
        })
        .collect();

    Ok(Json(response))
}
