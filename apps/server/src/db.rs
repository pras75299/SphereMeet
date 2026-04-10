use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2, Params,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Maximum spaces a single user may create.
pub const MAX_USER_SPACES: i64 = 3;

/// Default demo space; created at server startup (idempotent).
pub const MAIN_OFFICE_NAME: &str = "Main Office";

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

    // Auth columns migration (idempotent — safe to run on existing databases)
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT"
    ).execute(pool).await?;
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT"
    ).execute(pool).await?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL"
    ).execute(pool).await?;

    // Space ownership migration (idempotent)
    sqlx::query(
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id)"
    ).execute(pool).await?;

    // Deduplicate system spaces (owner_id IS NULL) that share the same name.
    // Keeps the entry that already has a map; if none do, keeps the newest.
    // Cascade delete removes associated maps/zones automatically.
    sqlx::query(
        r#"
        DELETE FROM spaces
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY name
                           ORDER BY
                               (SELECT COUNT(*) FROM maps WHERE maps.space_id = spaces.id) DESC,
                               created_at DESC
                       ) AS rn
                FROM spaces
                WHERE owner_id IS NULL
            ) ranked
            WHERE rn > 1
        )
        "#,
    ).execute(pool).await?;

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

/// Internal type used only for auth — includes the stored password hash.
#[derive(Debug, sqlx::FromRow)]
pub struct UserWithCredentials {
    pub id: Uuid,
    pub display_name: String,
    pub password_hash: Option<String>,
}

pub async fn create_registered_user(
    pool: &PgPool,
    email: &str,
    display_name: &str,
    password_hash: &str,
) -> AppResult<User> {
    let id = Uuid::new_v4();
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (id, display_name, email, password_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id, display_name, created_at
        "#,
    )
    .bind(id)
    .bind(display_name)
    .bind(email)
    .bind(password_hash)
    .fetch_one(pool)
    .await?;

    Ok(user)
}

pub async fn get_user_by_email(pool: &PgPool, email: &str) -> AppResult<Option<UserWithCredentials>> {
    let user = sqlx::query_as::<_, UserWithCredentials>(
        "SELECT id, display_name, password_hash FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

// Space operations
/// List all spaces ordered by creation date (newest first).
pub async fn list_spaces(pool: &PgPool) -> AppResult<Vec<Space>> {
    let spaces = sqlx::query_as::<_, Space>(
        "SELECT id, name, created_at FROM spaces ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(spaces)
}

/// Create a space owned by a user. The new space gets a default 15×10 floor layout.
///
/// Quota is enforced inside a transaction: the owner row is locked with `FOR UPDATE` so
/// concurrent creates cannot exceed [`MAX_USER_SPACES`].
pub async fn create_owned_space(pool: &PgPool, name: &str, owner_id: Uuid) -> AppResult<Space> {
    let mut tx = pool.begin().await?;

    let user_ok = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE id = $1 FOR UPDATE",
    )
    .bind(owner_id)
    .fetch_optional(&mut *tx)
    .await?;

    if user_ok.is_none() {
        return Err(AppError::NotFound("User not found".to_string()));
    }

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM spaces WHERE owner_id = $1",
    )
    .bind(owner_id)
    .fetch_one(&mut *tx)
    .await?;

    if count >= MAX_USER_SPACES {
        return Err(AppError::BadRequest(format!(
            "You can create at most {} spaces",
            MAX_USER_SPACES
        )));
    }

    let id = Uuid::new_v4();
    let space = sqlx::query_as::<_, Space>(
        r#"
        INSERT INTO spaces (id, name, owner_id)
        VALUES ($1, $2, $3)
        RETURNING id, name, created_at
        "#,
    )
    .bind(id)
    .bind(name)
    .bind(owner_id)
    .fetch_one(&mut *tx)
    .await?;

    create_default_floor(&mut *tx, space.id).await?;

    tx.commit().await?;
    Ok(space)
}

async fn create_default_floor<'e, E>(executor: E, space_id: Uuid) -> AppResult<()>
where
    E: Executor<'e, Database = Postgres>,
{
    const WIDTH: i32 = 15;
    const HEIGHT: i32 = 10;
    let tiles: Vec<i32> = vec![1; (WIDTH * HEIGHT) as usize];
    let mut blocked: Vec<i32> = Vec::new();
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            if x == 0 || x == WIDTH - 1 || y == 0 || y == HEIGHT - 1 {
                blocked.push(y * WIDTH + x);
            }
        }
    }
    create_map(
        executor,
        space_id,
        Some("Floor"),
        WIDTH,
        HEIGHT,
        json!(tiles),
        json!(blocked),
    )
    .await?;
    Ok(())
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

pub async fn create_map<'e, E>(
    executor: E,
    space_id: Uuid,
    name: Option<&str>,
    width: i32,
    height: i32,
    tiles: serde_json::Value,
    blocked: serde_json::Value,
) -> AppResult<Map>
where
    E: Executor<'e, Database = Postgres>,
{
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
    .fetch_one(executor)
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

/// Seed two demo accounts (idempotent — skips if email already exists).
/// Credentials: alice@spheremeet.demo / demo1234  and  bob@spheremeet.demo / demo1234
pub async fn ensure_demo_users(pool: &PgPool) -> AppResult<()> {
    let demo_accounts = [
        ("alice@spheremeet.demo", "Alice"),
        ("bob@spheremeet.demo", "Bob"),
    ];
    for (email, display_name) in demo_accounts {
        if get_user_by_email(pool, email).await?.is_some() {
            continue;
        }
        let pwd = "demo1234".to_string();
        let hash = tokio::task::spawn_blocking(move || {
            let params = Params::new(8192, 3, 1, None).expect("valid argon2 params");
            let salt = SaltString::generate(&mut OsRng);
            Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params)
                .hash_password(pwd.as_bytes(), &salt)
                .map(|h| h.to_string())
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(|e| AppError::Internal(e.to_string()))?;

        match create_registered_user(pool, email, display_name, &hash).await {
            Ok(_) => tracing::info!("Demo user seeded: {}", email),
            Err(e) => {
                tracing::warn!("Failed to seed demo user {}: {:?}", email, e);
                return Err(e);
            }
        }
    }
    Ok(())
}

/// Ensure Main Office exists with the standard floor map and zones. Idempotent.
pub async fn ensure_main_office(pool: &PgPool) -> AppResult<Uuid> {
    if let Some(space) = get_space_by_name(pool, MAIN_OFFICE_NAME).await? {
        if get_map_for_space(pool, space.id).await?.is_none() {
            populate_main_office_floor(pool, space.id).await?;
        }
        return Ok(space.id);
    }
    let space = create_space(pool, MAIN_OFFICE_NAME).await?;
    populate_main_office_floor(pool, space.id).await?;
    Ok(space.id)
}

async fn populate_main_office_floor(pool: &PgPool, space_id: Uuid) -> AppResult<()> {
    const WIDTH: i32 = 20;
    const HEIGHT: i32 = 15;
    let tile_count = WIDTH * HEIGHT;
    let tiles: Vec<i32> = vec![1; tile_count as usize];
    let mut blocked: Vec<i32> = Vec::new();
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            if x == 0 || x == WIDTH - 1 || y == 0 || y == HEIGHT - 1 {
                blocked.push(y * WIDTH + x);
            }
        }
    }
    create_map(
        pool,
        space_id,
        Some("Office Floor"),
        WIDTH,
        HEIGHT,
        json!(tiles),
        json!(blocked),
    )
    .await?;
    create_zone(pool, space_id, Some("Meeting Room A"), 2, 2, 4, 4).await?;
    create_zone(pool, space_id, Some("Meeting Room B"), 14, 2, 4, 4).await?;
    create_zone(pool, space_id, Some("Lounge"), 8, 8, 4, 4).await?;
    create_zone(pool, space_id, Some("Kitchen"), 2, 9, 4, 4).await?;
    Ok(())
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
