use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2, Params,
};
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::{create_token, AuthUser};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Explicit Argon2id parameters used for all password operations.
/// m=8192 (8 MiB), t=3, p=1 — well within OWASP interactive-login guidance and
/// fast enough on memory-constrained dev machines so logins don't time out.
fn argon2_params() -> Params {
    // unwrap: these constants are always valid
    Params::new(8192, 3, 1, None).expect("valid argon2 params")
}

/// Dummy hash used to perform a constant-time verification when a user is not
/// found during login. This prevents timing-based email enumeration.
/// Parameters MUST match argon2_params() so the timing is identical.
const DUMMY_HASH: &str =
    "$argon2id$v=19$m=8192,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/// Simple RFC-5322-aware email validation (no external deps).
fn is_valid_email(email: &str) -> bool {
    let email = email.trim();
    if email.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 {
        return false;
    }
    let (local, domain) = (parts[0], parts[1]);
    if local.is_empty() || local.starts_with('.') || local.ends_with('.') || local.contains("..") {
        return false;
    }
    if domain.is_empty() || !domain.contains('.') || domain.len() < 3 {
        return false;
    }
    for label in domain.split('.') {
        if label.is_empty()
            || label.starts_with('-')
            || label.ends_with('-')
            || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return false;
        }
    }
    true
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub display_name: String,
    pub avatar_color: Option<String>,
    pub avatar_emoji: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

// ── Guest (legacy) ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateGuestRequest {
    pub display_name: String,
}

pub async fn create_guest(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateGuestRequest>,
) -> AppResult<Json<AuthResponse>> {
    let display_name = payload.display_name.trim();
    if display_name.is_empty() || display_name.len() > 50 {
        return Err(AppError::BadRequest(
            "Display name must be 1-50 characters".to_string(),
        ));
    }

    let user = db::create_user(&state.pool, display_name).await?;
    let token = create_token(user.id, &user.display_name, user.avatar_color.as_deref(), user.avatar_emoji.as_deref())?;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            id: user.id,
            display_name: user.display_name,
            avatar_color: user.avatar_color,
            avatar_emoji: user.avatar_emoji,
        },
    }))
}

// ── Register ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub display_name: String,
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> AppResult<Json<AuthResponse>> {
    let email = payload.email.trim().to_lowercase();
    let display_name = payload.display_name.trim().to_string();
    let password = payload.password.clone();

    if !is_valid_email(&email) {
        return Err(AppError::BadRequest("Invalid email address".to_string()));
    }
    if password.len() < 8 || password.len() > 128 {
        return Err(AppError::BadRequest(
            "Password must be 8-128 characters".to_string(),
        ));
    }
    if display_name.is_empty() || display_name.len() > 50 {
        return Err(AppError::BadRequest(
            "Display name must be 1-50 characters".to_string(),
        ));
    }

    let password_hash = tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, argon2_params())
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Let the database unique constraint be the source of truth (avoids TOCTOU
    // race condition from a pre-check + insert pattern). Map the unique
    // violation to a generic conflict response — note the message does NOT
    // confirm whether the email exists to prevent enumeration.
    let user = match db::create_registered_user(&state.pool, &email, &display_name, &password_hash).await {
        Ok(u) => u,
        Err(AppError::Database(e)) if is_unique_violation(&e) => {
            return Err(AppError::BadRequest(
                "Registration failed. Try a different email or log in.".to_string(),
            ));
        }
        Err(e) => return Err(e),
    };

    let token = create_token(user.id, &user.display_name, user.avatar_color.as_deref(), user.avatar_emoji.as_deref())?;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            id: user.id,
            display_name: user.display_name,
            avatar_color: user.avatar_color,
            avatar_emoji: user.avatar_emoji,
        },
    }))
}

// ── Login ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    let email = payload.email.trim().to_lowercase();
    let password = payload.password.clone();

    if password.len() > 128 {
        return Err(AppError::Unauthorized);
    }

    let user_creds = db::get_user_by_email(&state.pool, &email).await?;

    // Always run Argon2 verification (constant time) regardless of whether the
    // user exists. This prevents timing-based email enumeration.
    let stored_hash = user_creds
        .as_ref()
        .and_then(|u| u.password_hash.as_deref())
        .unwrap_or(DUMMY_HASH)
        .to_string();

    let verify_ok = tokio::task::spawn_blocking(move || {
        let parsed = PasswordHash::new(&stored_hash).map_err(|e| e.to_string())?;
        // verify_password uses the params embedded in the PHC hash string, so
        // the Argon2 context here only needs to be valid (params are ignored for
        // verification).  We pass explicit params anyway for clarity.
        Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, argon2_params())
            .verify_password(password.as_bytes(), &parsed)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Return the same error regardless of whether the user exists or the
    // password is wrong — prevents login-path email enumeration.
    if user_creds.is_none() || verify_ok.is_err() {
        return Err(AppError::Unauthorized);
    }

    let user = user_creds.unwrap();
    let token = create_token(user.id, &user.display_name, user.avatar_color.as_deref(), user.avatar_emoji.as_deref())?;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            id: user.id,
            display_name: user.display_name,
            avatar_color: user.avatar_color,
            avatar_emoji: user.avatar_emoji,
        },
    }))
}

// ── Update Profile ────────────────────────────────────────────────────────────

// True PATCH semantics: omitted field = preserve, null/empty = clear, value = set.
// Double-Option lets us distinguish "field absent" (None) from "field explicitly null" (Some(None)).
fn deserialize_some<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize)]
pub struct PatchMeRequest {
    #[serde(default, deserialize_with = "deserialize_some")]
    pub avatar_color: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub avatar_emoji: Option<Option<String>>,
}

pub async fn patch_me(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(payload): Json<PatchMeRequest>,
) -> AppResult<Json<AuthResponse>> {
    let current = db::get_user(&state.pool, auth_user.user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Validate color: must be #rrggbb hex; null/empty clears; field absent preserves.
    let avatar_color: Option<String> = match payload.avatar_color {
        None => current.avatar_color,
        Some(None) => None,
        Some(Some(c)) if c.is_empty() => None,
        Some(Some(c)) => {
            let c = c.trim();
            if c.len() != 7 || !c.starts_with('#') || !c[1..].chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err(AppError::BadRequest("avatar_color must be a #rrggbb hex string".to_string()));
            }
            Some(c.to_lowercase())
        }
    };

    // Validate emoji: max 8 chars; null/empty clears; field absent preserves.
    let avatar_emoji: Option<String> = match payload.avatar_emoji {
        None => current.avatar_emoji,
        Some(None) => None,
        Some(Some(e)) if e.is_empty() => None,
        Some(Some(e)) => {
            if e.chars().count() > 8 {
                return Err(AppError::BadRequest("avatar_emoji must be 8 characters or fewer".to_string()));
            }
            Some(e)
        }
    };

    let user = db::update_user_avatar(
        &state.pool,
        auth_user.user_id,
        avatar_color.as_deref(),
        avatar_emoji.as_deref(),
    )
    .await?;

    let token = create_token(
        user.id,
        &user.display_name,
        user.avatar_color.as_deref(),
        user.avatar_emoji.as_deref(),
    )?;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            id: user.id,
            display_name: user.display_name,
            avatar_color: user.avatar_color,
            avatar_emoji: user.avatar_emoji,
        },
    }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn is_unique_violation(e: &sqlx::Error) -> bool {
    if let sqlx::Error::Database(db_err) = e {
        // PostgreSQL unique-violation code: 23505
        return db_err.code().as_deref() == Some("23505");
    }
    false
}
