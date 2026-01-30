use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub display_name: String,
    pub exp: i64,
    pub iat: i64,
}

pub fn create_token(user_id: Uuid, display_name: &str) -> AppResult<String> {
    let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev_secret_change_me".to_string());
    let now = Utc::now();
    let exp = now + Duration::days(7);

    let claims = Claims {
        sub: user_id,
        display_name: display_name.to_string(),
        exp: exp.timestamp(),
        iat: now.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(AppError::Jwt)
}

pub fn verify_token(token: &str) -> AppResult<Claims> {
    let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev_secret_change_me".to_string());

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(AppError::Jwt)?;

    Ok(token_data.claims)
}
