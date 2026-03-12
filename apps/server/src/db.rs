use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Space {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Map {
    pub id: Uuid,
    pub space_id: Uuid,
    pub name: Option<String>,
    pub width: i32,
    pub height: i32,
    pub tiles: serde_json::Value,
    pub blocked: serde_json::Value,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Zone {
    pub id: Uuid,
    pub space_id: Uuid,
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ChatMessage {
    pub id: Uuid,
    pub space_id: Uuid,
    pub channel: String,
    pub user_id: Uuid,
    pub body: String,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageWithUser {
    pub id: Uuid,
    pub space_id: Uuid,
    pub channel: String,
    pub user_id: Uuid,
    pub display_name: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

pub async fn run_migrations(pool: &PgPool) -> AppResult<()> {
    // Check if users table exists
    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')"
    )
    .fetch_one(pool)
    .await?;

    if !table_exists {
        // Run each migration statement individually
        let statements = [
            r#"CREATE TABLE users (
                id UUID PRIMARY KEY,
                display_name TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"#,
            r#"CREATE TABLE spaces (
                id UUID PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"#,
            r#"CREATE TABLE maps (
                id UUID PRIMARY KEY,
                space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                name TEXT,
                width INT NOT NULL,
                height INT NOT NULL,
                tiles JSONB NOT NULL,
                blocked JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )"#,
            r#"CREATE TABLE zones (
                id UUID PRIMARY KEY,
                space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                name TEXT,
                x INT NOT NULL,
                y INT NOT NULL,
                w INT NOT NULL,
                h INT NOT NULL
            )"#,
            r#"CREATE TABLE chat_messages (
                id UUID PRIMARY KEY,
                space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                channel TEXT NOT NULL,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )"#,
            "CREATE INDEX idx_chat_messages_space_channel ON chat_messages(space_id, channel, created_at DESC)",
            "CREATE INDEX idx_maps_space ON maps(space_id)",
            "CREATE INDEX idx_zones_space ON zones(space_id)",
        ];

        for statement in statements {
            sqlx::query(statement).execute(pool).await?;
        }
    }

    Ok(())
}

// User operations
pub async fn create_user(pool: &PgPool, display_name: &str) -> AppResult<User> {
    let id = Uuid::new_v4();
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (id, display_name)
        VALUES ($1, $2)
        RETURNING id, display_name, created_at
        "#,
    )
    .bind(id)
    .bind(display_name)
    .fetch_one(pool)
    .await?;

    Ok(user)
}

pub async fn get_user(pool: &PgPool, id: Uuid) -> AppResult<Option<User>> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, display_name, created_at FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

// Space operations
/// List spaces, one per name (keeps most recent if duplicates exist e.g. multiple "Main Office").
pub async fn list_spaces(pool: &PgPool) -> AppResult<Vec<Space>> {
    let spaces = sqlx::query_as::<_, Space>(
        r#"
        SELECT id, name, created_at FROM (
            SELECT DISTINCT ON (name) id, name, created_at
            FROM spaces
            ORDER BY name, created_at DESC
        ) AS deduped
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(spaces)
}

pub async fn get_space(pool: &PgPool, id: Uuid) -> AppResult<Option<Space>> {
    let space = sqlx::query_as::<_, Space>(
        "SELECT id, name, created_at FROM spaces WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(space)
}

pub async fn get_space_by_name(pool: &PgPool, name: &str) -> AppResult<Option<Space>> {
    let space = sqlx::query_as::<_, Space>(
        "SELECT id, name, created_at FROM spaces WHERE name = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?;

    Ok(space)
}

pub async fn create_space(pool: &PgPool, name: &str) -> AppResult<Space> {
    let id = Uuid::new_v4();
    let space = sqlx::query_as::<_, Space>(
        r#"
        INSERT INTO spaces (id, name)
        VALUES ($1, $2)
        RETURNING id, name, created_at
        "#,
    )
    .bind(id)
    .bind(name)
    .fetch_one(pool)
    .await?;

    Ok(space)
}

// Map operations
pub async fn get_map_for_space(pool: &PgPool, space_id: Uuid) -> AppResult<Option<Map>> {
    let map = sqlx::query_as::<_, Map>(
        "SELECT id, space_id, name, width, height, tiles, blocked, created_at FROM maps WHERE space_id = $1",
    )
    .bind(space_id)
    .fetch_optional(pool)
    .await?;

    Ok(map)
}

pub async fn create_map(
    pool: &PgPool,
    space_id: Uuid,
    name: Option<&str>,
    width: i32,
    height: i32,
    tiles: serde_json::Value,
    blocked: serde_json::Value,
) -> AppResult<Map> {
    let id = Uuid::new_v4();
    let map = sqlx::query_as::<_, Map>(
        r#"
        INSERT INTO maps (id, space_id, name, width, height, tiles, blocked)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, space_id, name, width, height, tiles, blocked, created_at
        "#,
    )
    .bind(id)
    .bind(space_id)
    .bind(name)
    .bind(width)
    .bind(height)
    .bind(tiles)
    .bind(blocked)
    .fetch_one(pool)
    .await?;

    Ok(map)
}

// Zone operations
pub async fn get_zones_for_space(pool: &PgPool, space_id: Uuid) -> AppResult<Vec<Zone>> {
    let zones = sqlx::query_as::<_, Zone>(
        "SELECT id, space_id, name, x, y, w, h FROM zones WHERE space_id = $1",
    )
    .bind(space_id)
    .fetch_all(pool)
    .await?;

    Ok(zones)
}

pub async fn create_zone(
    pool: &PgPool,
    space_id: Uuid,
    name: Option<&str>,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> AppResult<Zone> {
    let id = Uuid::new_v4();
    let zone = sqlx::query_as::<_, Zone>(
        r#"
        INSERT INTO zones (id, space_id, name, x, y, w, h)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, space_id, name, x, y, w, h
        "#,
    )
    .bind(id)
    .bind(space_id)
    .bind(name)
    .bind(x)
    .bind(y)
    .bind(w)
    .bind(h)
    .fetch_one(pool)
    .await?;

    Ok(zone)
}

// Chat operations
pub async fn get_chat_messages(
    pool: &PgPool,
    space_id: Uuid,
    channel: &str,
    limit: i64,
) -> AppResult<Vec<ChatMessageWithUser>> {
    let mut messages = sqlx::query_as::<_, (Uuid, Uuid, String, Uuid, String, String, Option<DateTime<Utc>>)>(
        r#"
        SELECT cm.id, cm.space_id, cm.channel, cm.user_id, u.display_name, cm.body, cm.created_at
        FROM chat_messages cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.space_id = $1 AND cm.channel = $2
        ORDER BY cm.created_at DESC
        LIMIT $3
        "#,
    )
    .bind(space_id)
    .bind(channel)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    // Reverse to return in chronological order (oldest first, but among the newest N messages)
    messages.reverse();

    let result = messages
        .into_iter()
        .map(|(id, space_id, channel, user_id, display_name, body, created_at)| {
            ChatMessageWithUser {
                id,
                space_id,
                channel,
                user_id,
                display_name,
                body,
                created_at: created_at.unwrap_or_else(Utc::now),
            }
        })
        .collect();

    Ok(result)
}

pub async fn create_chat_message(
    pool: &PgPool,
    space_id: Uuid,
    channel: &str,
    user_id: Uuid,
    body: &str,
) -> AppResult<ChatMessage> {
    let id = Uuid::new_v4();
    let message = sqlx::query_as::<_, ChatMessage>(
        r#"
        INSERT INTO chat_messages (id, space_id, channel, user_id, body)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, space_id, channel, user_id, body, created_at
        "#,
    )
    .bind(id)
    .bind(space_id)
    .bind(channel)
    .bind(user_id)
    .bind(body)
    .fetch_one(pool)
    .await?;

    Ok(message)
}
