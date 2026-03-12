use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// JWT secret - required in production, uses default only in development
static JWT_SECRET: Lazy<String> = Lazy::new(|| {
    let is_production = std::env::var("RUST_ENV")
        .map(|v| v == "production")
        .unwrap_or(false);
    
    match std::env::var("JWT_SECRET") {
        Ok(secret) => {
            if secret.len() < 32 {
                panic!("JWT_SECRET must be at least 32 characters long");
            }
            secret
        }
        Err(_) => {
            if is_production {
                panic!("JWT_SECRET must be set in production environment");
            }
            tracing::warn!("Using default JWT_SECRET - DO NOT use in production!");
            "dev_secret_change_me_at_least_32_chars".to_string()
        }
    }
});

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub display_name: String,
    pub exp: i64,
    pub iat: i64,
}

pub fn create_token(user_id: Uuid, display_name: &str) -> AppResult<String> {
    let now = Utc::now();
    let exp = now + Duration::days(7);

    let claims = Claims {
        sub: user_id,
        display_name: display_name.to_string(),
        exp: exp.timestamp(),
        iat: now.timestamp(),
    };

    let header = Header::new(Algorithm::HS256);
    let key = EncodingKey::from_secret(JWT_SECRET.as_bytes());
    
    tracing::debug!("Creating JWT token for user: {}", user_id);
    
    encode(&header, &claims, &key).map_err(|e| {
        tracing::error!("JWT encode error: {:?}", e);
        AppError::Jwt(e)
    })
}

pub fn verify_token(token: &str) -> AppResult<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp", "iat", "sub"]);
    
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(JWT_SECRET.as_bytes()),
        &validation,
    )
    .map_err(AppError::Jwt)?;

    Ok(token_data.claims)
}

/// Authenticated user extractor for protected routes
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub display_name: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Try to get token from Authorization header
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok());

        let token = match auth_header {
            Some(header) if header.starts_with("Bearer ") => &header[7..],
            _ => return Err((StatusCode::UNAUTHORIZED, "Missing or invalid Authorization header")),
        };

        match verify_token(token) {
            Ok(claims) => Ok(AuthUser {
                user_id: claims.sub,
                display_name: claims.display_name,
            }),
            Err(_) => Err((StatusCode::UNAUTHORIZED, "Invalid or expired token")),
        }
    }
}

/// Optional authenticated user - doesn't reject if no auth
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct OptionalAuthUser(pub Option<AuthUser>);

#[async_trait]
impl<S> FromRequestParts<S> for OptionalAuthUser
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match AuthUser::from_request_parts(parts, state).await {
            Ok(user) => Ok(OptionalAuthUser(Some(user))),
            Err(_) => Ok(OptionalAuthUser(None)),
        }
    }
}
