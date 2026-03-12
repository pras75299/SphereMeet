use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
};
use chrono::{Duration, Utc};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::auth::verify_token;
use crate::db;
use crate::state::{AppState, CachedMapData, CachedZone, CHANNEL_CAPACITY, PROXIMITY_SIGNAL_GRACE_MS};

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub token: String,
    pub space_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub payload: serde_json::Value,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    // Verify token
    let claims = match verify_token(&query.token) {
        Ok(c) => c,
        Err(_) => {
            return Response::builder()
                .status(401)
                .body("Unauthorized".into())
                .unwrap();
        }
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, claims.sub, claims.display_name, query.space_id))
}

async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    user_id: Uuid,
    display_name: String,
    space_id: Uuid,
) {
    let (mut sender, mut receiver) = socket.split();
    
    // Use bounded channel to prevent memory exhaustion from slow clients
    let (tx, mut rx) = mpsc::channel::<String>(CHANNEL_CAPACITY);

    // Add client to state
    state.add_client(space_id, user_id, display_name.clone(), tx).await;

    tracing::info!("User {} joined space {}", user_id, space_id);

    // Send initial state and cache map data
    if let Err(e) = send_joined_message(&state, &mut sender, user_id, &display_name, space_id).await {
        tracing::error!("Failed to send joined message: {:?}", e);
        state.remove_client(space_id, user_id).await;
        return;
    }

    // Broadcast join to others (single-user update)
    let presence = state.get_presence_list(space_id).await;
    if let Some(user_presence) = presence.iter().find(|p| p.user_id == user_id) {
        let msg = WsMessage {
            msg_type: "server.presence.update".to_string(),
            payload: json!({
                "user_id": user_id,
                "x": user_presence.x,
                "y": user_presence.y,
                "dir": user_presence.dir,
                "zone_id": user_presence.zone_id,
                "display_name": display_name
            }),
        };
        state.broadcast_to_space(space_id, &serde_json::to_string(&msg).unwrap(), Some(user_id)).await;
    }
    // Broadcast full presence snapshot to everyone so all clients stay in sync (fixes avatars disappearing after rejoin)
    let snapshot_msg = WsMessage {
        msg_type: "server.presence.snapshot".to_string(),
        payload: json!({
            "presence": presence.iter().map(|p| json!({
                "user_id": p.user_id,
                "display_name": p.display_name,
                "x": p.x,
                "y": p.y,
                "dir": p.dir,
                "zone_id": p.zone_id
            })).collect::<Vec<_>>()
        }),
    };
    state.broadcast_to_space(space_id, &serde_json::to_string(&snapshot_msg).unwrap(), None).await;

    // Compute initial proximity
    let proximity_changes = state.compute_proximity(space_id).await;
    for (uid, peers) in proximity_changes {
        if let Some(sender) = state.get_client_sender(space_id, uid).await {
            let msg = WsMessage {
                msg_type: "server.proximity".to_string(),
                payload: json!({
                    "peers": peers.into_iter().collect::<Vec<_>>()
                }),
            };
            let _ = sender.try_send(serde_json::to_string(&msg).unwrap());
        }
    }

    // Use a cancellation token for cleanup
    let cancel_token = tokio_util::sync::CancellationToken::new();
    let cancel_token_send = cancel_token.clone();
    let cancel_token_proximity = cancel_token.clone();

    // Spawn task to forward messages from channel to WebSocket
    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_token_send.cancelled() => {
                    break;
                }
                msg = rx.recv() => {
                    match msg {
                        Some(msg) => {
                            if sender.send(Message::Text(msg)).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
            }
        }
    });

    // Spawn proximity tick task
    let proximity_state = state.clone();
    let proximity_space_id = space_id;
    let proximity_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
        loop {
            tokio::select! {
                _ = cancel_token_proximity.cancelled() => {
                    break;
                }
                _ = interval.tick() => {
                    let changes = proximity_state.compute_proximity(proximity_space_id).await;
                    for (uid, peers) in changes {
                        if let Some(sender) = proximity_state.get_client_sender(proximity_space_id, uid).await {
                            let msg = WsMessage {
                                msg_type: "server.proximity".to_string(),
                                payload: json!({
                                    "peers": peers.into_iter().collect::<Vec<_>>()
                                }),
                            };
                            let _ = sender.try_send(serde_json::to_string(&msg).unwrap());
                        }
                    }
                }
            }
        }
    });

    // Handle incoming messages
    while let Some(result) = receiver.next().await {
        match result {
            Ok(msg) => match msg {
                Message::Text(text) => {
                    if let Err(e) = handle_client_message(&state, user_id, space_id, &text).await {
                        tracing::error!("Error handling message: {:?}", e);
                    }
                }
                Message::Close(_) => break,
                Message::Ping(data) => {
                    // Respond to pings (keep-alive)
                    if let Some(sender) = state.get_client_sender(space_id, user_id).await {
                        let _ = sender.try_send(format!("pong:{}", String::from_utf8_lossy(&data)));
                    }
                }
                _ => {}
            },
            Err(e) => {
                tracing::warn!("WebSocket error for user {}: {:?}", user_id, e);
                break;
            }
        }
    }

    // Cleanup - cancel background tasks
    cancel_token.cancel();
    
    // Wait for tasks to complete (with timeout)
    let _ = tokio::time::timeout(
        tokio::time::Duration::from_secs(1),
        async {
            let _ = send_task.await;
            let _ = proximity_task.await;
        }
    ).await;

    // Broadcast leave
    let leave_msg = WsMessage {
        msg_type: "server.presence.leave".to_string(),
        payload: json!({ "user_id": user_id }),
    };
    state.broadcast_to_space(space_id, &serde_json::to_string(&leave_msg).unwrap(), Some(user_id)).await;

    state.remove_client(space_id, user_id).await;
    tracing::info!("User {} left space {}", user_id, space_id);

    // Recompute proximity after user leaves
    let proximity_changes = state.compute_proximity(space_id).await;
    for (uid, peers) in proximity_changes {
        if let Some(sender) = state.get_client_sender(space_id, uid).await {
            let msg = WsMessage {
                msg_type: "server.proximity".to_string(),
                payload: json!({
                    "peers": peers.into_iter().collect::<Vec<_>>()
                }),
            };
            let _ = sender.try_send(serde_json::to_string(&msg).unwrap());
        }
    }
}

async fn send_joined_message(
    state: &AppState,
    sender: &mut futures::stream::SplitSink<WebSocket, Message>,
    user_id: Uuid,
    display_name: &str,
    space_id: Uuid,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Get space details
    let space = db::get_space(&state.pool, space_id).await?.ok_or("Space not found")?;
    let map = db::get_map_for_space(&state.pool, space_id).await?;
    let zones = db::get_zones_for_space(&state.pool, space_id).await?;
    let presence = state.get_presence_list(space_id).await;

    // Cache map data for fast validation
    if let Some(ref m) = map {
        let blocked_set: HashSet<i32> = m.blocked
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_i64().map(|n| n as i32)).collect())
            .unwrap_or_default();

        state.cache_map_data(space_id, CachedMapData {
            width: m.width,
            height: m.height,
            blocked: blocked_set,
        }).await;
    }

    // Cache zones
    let cached_zones: Vec<CachedZone> = zones.iter().map(|z| CachedZone {
        id: z.id,
        name: z.name.clone(),
        x: z.x,
        y: z.y,
        w: z.w,
        h: z.h,
    }).collect();
    state.cache_zones(space_id, cached_zones).await;

    let msg = WsMessage {
        msg_type: "server.joined".to_string(),
        payload: json!({
            "self": {
                "user_id": user_id,
                "display_name": display_name
            },
            "space": {
                "space_id": space.id,
                "name": space.name
            },
            "map": map.as_ref().map(|m| json!({
                "map_id": m.id,
                "width": m.width,
                "height": m.height,
                "tiles": m.tiles,
                "blocked": m.blocked
            })),
            "zones": zones.into_iter().map(|z| json!({
                "zone_id": z.id,
                "name": z.name,
                "x": z.x,
                "y": z.y,
                "w": z.w,
                "h": z.h
            })).collect::<Vec<_>>(),
            "presence": presence.into_iter().map(|p| json!({
                "user_id": p.user_id,
                "display_name": p.display_name,
                "x": p.x,
                "y": p.y,
                "dir": p.dir,
                "zone_id": p.zone_id
            })).collect::<Vec<_>>()
        }),
    };

    sender
        .send(Message::Text(serde_json::to_string(&msg)?))
        .await?;

    Ok(())
}

async fn handle_client_message(
    state: &AppState,
    user_id: Uuid,
    space_id: Uuid,
    text: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let msg: WsMessage = serde_json::from_str(text)?;

    match msg.msg_type.as_str() {
        "client.move" => {
            handle_move(state, user_id, space_id, &msg.payload).await?;
        }
        "client.chat.send" => {
            handle_chat_send(state, user_id, space_id, &msg.payload).await?;
        }
        "client.webrtc.offer" => {
            handle_webrtc_signal(state, user_id, space_id, "server.webrtc.offer", &msg.payload).await?;
        }
        "client.webrtc.answer" => {
            handle_webrtc_signal(state, user_id, space_id, "server.webrtc.answer", &msg.payload).await?;
        }
        "client.webrtc.ice" => {
            handle_webrtc_signal(state, user_id, space_id, "server.webrtc.ice", &msg.payload).await?;
        }
        _ => {
            tracing::warn!("Unknown message type: {}", msg.msg_type);
        }
    }

    Ok(())
}

async fn handle_move(
    state: &AppState,
    user_id: Uuid,
    space_id: Uuid,
    payload: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let x = payload["x"].as_i64().ok_or("Missing x")? as i32;
    let y = payload["y"].as_i64().ok_or("Missing y")? as i32;
    let dir = payload["dir"].as_str().ok_or("Missing dir")?;

    // Validate direction
    if !["up", "down", "left", "right"].contains(&dir) {
        return Err("Invalid direction".into());
    }

    // Validate move using cached data (no DB query!)
    state.validate_move(space_id, x, y).await?;

    // Find zone using cached data (no DB query!)
    let zone_id = state.find_zone_for_position(space_id, x, y).await;

    // Update presence
    state.update_presence(space_id, user_id, x, y, dir, zone_id).await;

    // Get display_name for broadcast
    let display_name = {
        let presence_list = state.get_presence_list(space_id).await;
        presence_list
            .iter()
            .find(|p| p.user_id == user_id)
            .map(|p| p.display_name.clone())
    };

    // Broadcast position update
    let msg = WsMessage {
        msg_type: "server.presence.update".to_string(),
        payload: json!({
            "user_id": user_id,
            "x": x,
            "y": y,
            "dir": dir,
            "zone_id": zone_id,
            "display_name": display_name
        }),
    };
    state.broadcast_to_space(space_id, &serde_json::to_string(&msg)?, None).await;

    // Recompute proximity
    let proximity_changes = state.compute_proximity(space_id).await;
    for (uid, peers) in proximity_changes {
        if let Some(sender) = state.get_client_sender(space_id, uid).await {
            let msg = WsMessage {
                msg_type: "server.proximity".to_string(),
                payload: json!({
                    "peers": peers.into_iter().collect::<Vec<_>>()
                }),
            };
            let _ = sender.try_send(serde_json::to_string(&msg)?);
        }
    }

    Ok(())
}

async fn handle_chat_send(
    state: &AppState,
    user_id: Uuid,
    space_id: Uuid,
    payload: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let channel = payload["channel"].as_str().ok_or("Missing channel")?;
    let body = payload["body"].as_str().ok_or("Missing body")?;

    if body.trim().is_empty() {
        return Err("Empty message".into());
    }

    // Enforce maximum message length (1000 chars)
    if body.len() > 1000 {
        return Err("Message too long (max 1000 characters)".into());
    }

    // Sanitize channel name
    if channel.len() > 50 || !channel.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err("Invalid channel name".into());
    }

    // Get user display name
    let user = db::get_user(&state.pool, user_id).await?.ok_or("User not found")?;

    // Save to database
    let message = db::create_chat_message(&state.pool, space_id, channel, user_id, body).await?;

    // Broadcast to space
    let msg = WsMessage {
        msg_type: "server.chat.new".to_string(),
        payload: json!({
            "id": message.id,
            "channel": channel,
            "user_id": user_id,
            "display_name": user.display_name,
            "body": body,
            "created_at": message.created_at.unwrap_or_else(Utc::now).to_rfc3339()
        }),
    };
    state.broadcast_to_space(space_id, &serde_json::to_string(&msg)?, None).await;

    Ok(())
}

async fn handle_webrtc_signal(
    state: &AppState,
    from_user_id: Uuid,
    space_id: Uuid,
    msg_type: &str,
    payload: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let to_user_id_str = payload["to_user_id"].as_str().ok_or("Missing to_user_id")?;
    let to_user_id = Uuid::parse_str(to_user_id_str)?;

    // Check if users are in proximity or within grace period
    let in_proximity = state.is_in_proximity(space_id, from_user_id, to_user_id).await;
    
    if !in_proximity {
        // Check grace period
        let grace_duration = Duration::milliseconds(PROXIMITY_SIGNAL_GRACE_MS as i64);
        let last_updated = state.get_proximity_last_updated(space_id, from_user_id).await;
        
        if let Some(last) = last_updated {
            if Utc::now() - last > grace_duration {
                tracing::warn!("Dropping signaling message: users not in proximity");
                return Ok(());
            }
        } else {
            tracing::warn!("Dropping signaling message: no proximity data");
            return Ok(());
        }
    }

    // Forward the message
    if let Some(sender) = state.get_client_sender(space_id, to_user_id).await {
        let mut forward_payload = payload.clone();
        if let Some(obj) = forward_payload.as_object_mut() {
            obj.remove("to_user_id");
            obj.insert("from_user_id".to_string(), json!(from_user_id.to_string()));
        }

        let msg = WsMessage {
            msg_type: msg_type.to_string(),
            payload: forward_payload,
        };
        let _ = sender.try_send(serde_json::to_string(&msg)?);
    }

    Ok(())
}
