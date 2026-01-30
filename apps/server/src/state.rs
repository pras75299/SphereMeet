use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

// Proximity constants
pub const RADIUS_TILES: i32 = 4;
pub const HYSTERESIS_OUT_TILES: i32 = 5;
pub const MAX_PROXIMITY_PEERS: usize = 6;
pub const PROXIMITY_SIGNAL_GRACE_MS: u64 = 3000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPresence {
    pub user_id: Uuid,
    pub display_name: String,
    pub x: i32,
    pub y: i32,
    pub dir: String,
    pub zone_id: Option<Uuid>,
    pub last_seen: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ClientConnection {
    pub user_id: Uuid,
    pub display_name: String,
    pub space_id: Uuid,
    pub sender: mpsc::UnboundedSender<String>,
}

#[derive(Debug, Clone)]
pub struct ProximityEntry {
    pub peers: HashSet<Uuid>,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug)]
pub struct SpaceState {
    pub clients: HashMap<Uuid, ClientConnection>,
    pub presence: HashMap<Uuid, UserPresence>,
    pub proximity_cache: HashMap<Uuid, ProximityEntry>,
}

impl SpaceState {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            presence: HashMap::new(),
            proximity_cache: HashMap::new(),
        }
    }
}

#[derive(Debug)]
pub struct AppState {
    pub pool: PgPool,
    pub spaces: RwLock<HashMap<Uuid, SpaceState>>,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            spaces: RwLock::new(HashMap::new()),
        }
    }

    pub async fn add_client(
        &self,
        space_id: Uuid,
        user_id: Uuid,
        display_name: String,
        sender: mpsc::UnboundedSender<String>,
    ) {
        let mut spaces = self.spaces.write().await;
        let space = spaces.entry(space_id).or_insert_with(SpaceState::new);

        space.clients.insert(
            user_id,
            ClientConnection {
                user_id,
                display_name: display_name.clone(),
                space_id,
                sender,
            },
        );

        // Initialize presence at a default position
        space.presence.insert(
            user_id,
            UserPresence {
                user_id,
                display_name,
                x: 5,
                y: 5,
                dir: "down".to_string(),
                zone_id: None,
                last_seen: Utc::now(),
            },
        );
    }

    pub async fn remove_client(&self, space_id: Uuid, user_id: Uuid) {
        let mut spaces = self.spaces.write().await;
        if let Some(space) = spaces.get_mut(&space_id) {
            space.clients.remove(&user_id);
            space.presence.remove(&user_id);
            space.proximity_cache.remove(&user_id);

            // Remove this user from other users' proximity caches
            for (_, entry) in space.proximity_cache.iter_mut() {
                entry.peers.remove(&user_id);
            }
        }
    }

    pub async fn update_presence(
        &self,
        space_id: Uuid,
        user_id: Uuid,
        x: i32,
        y: i32,
        dir: &str,
        zone_id: Option<Uuid>,
    ) {
        let mut spaces = self.spaces.write().await;
        if let Some(space) = spaces.get_mut(&space_id) {
            if let Some(presence) = space.presence.get_mut(&user_id) {
                presence.x = x;
                presence.y = y;
                presence.dir = dir.to_string();
                presence.zone_id = zone_id;
                presence.last_seen = Utc::now();
            }
        }
    }

    pub async fn get_presence_list(&self, space_id: Uuid) -> Vec<UserPresence> {
        let spaces = self.spaces.read().await;
        if let Some(space) = spaces.get(&space_id) {
            space.presence.values().cloned().collect()
        } else {
            Vec::new()
        }
    }

    pub async fn get_client_sender(&self, space_id: Uuid, user_id: Uuid) -> Option<mpsc::UnboundedSender<String>> {
        let spaces = self.spaces.read().await;
        if let Some(space) = spaces.get(&space_id) {
            space.clients.get(&user_id).map(|c| c.sender.clone())
        } else {
            None
        }
    }

    pub async fn broadcast_to_space(&self, space_id: Uuid, message: &str, exclude_user: Option<Uuid>) {
        let spaces = self.spaces.read().await;
        if let Some(space) = spaces.get(&space_id) {
            for (uid, client) in &space.clients {
                if exclude_user.map_or(true, |exc| exc != *uid) {
                    let _ = client.sender.send(message.to_string());
                }
            }
        }
    }

    pub async fn compute_proximity(&self, space_id: Uuid) -> HashMap<Uuid, HashSet<Uuid>> {
        let mut spaces = self.spaces.write().await;
        let space = match spaces.get_mut(&space_id) {
            Some(s) => s,
            None => return HashMap::new(),
        };

        let users: Vec<(Uuid, i32, i32)> = space
            .presence
            .iter()
            .map(|(id, p)| (*id, p.x, p.y))
            .collect();

        let mut new_proximity: HashMap<Uuid, HashSet<Uuid>> = HashMap::new();

        for (user_id, x1, y1) in &users {
            let mut distances: Vec<(Uuid, f64)> = Vec::new();

            for (other_id, x2, y2) in &users {
                if user_id == other_id {
                    continue;
                }

                let dx = (*x2 - *x1) as f64;
                let dy = (*y2 - *y1) as f64;
                let dist = (dx * dx + dy * dy).sqrt();

                // Check if peer was previously in proximity
                let was_in_proximity = space
                    .proximity_cache
                    .get(user_id)
                    .map_or(false, |entry| entry.peers.contains(other_id));

                // Hysteresis: enter at RADIUS_TILES, exit at HYSTERESIS_OUT_TILES
                let in_range = if was_in_proximity {
                    dist <= HYSTERESIS_OUT_TILES as f64
                } else {
                    dist <= RADIUS_TILES as f64
                };

                if in_range {
                    distances.push((*other_id, dist));
                }
            }

            // Sort by distance, then by user_id for tie-breaking
            distances.sort_by(|a, b| {
                a.1.partial_cmp(&b.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.0.to_string().cmp(&b.0.to_string()))
            });

            // Cap at MAX_PROXIMITY_PEERS
            let peers: HashSet<Uuid> = distances
                .into_iter()
                .take(MAX_PROXIMITY_PEERS)
                .map(|(id, _)| id)
                .collect();

            new_proximity.insert(*user_id, peers);
        }

        // Update proximity cache and find changes
        let mut changes: HashMap<Uuid, HashSet<Uuid>> = HashMap::new();

        for (user_id, new_peers) in &new_proximity {
            let old_peers = space
                .proximity_cache
                .get(user_id)
                .map(|e| &e.peers)
                .cloned()
                .unwrap_or_default();

            if *new_peers != old_peers {
                changes.insert(*user_id, new_peers.clone());
            }

            space.proximity_cache.insert(
                *user_id,
                ProximityEntry {
                    peers: new_peers.clone(),
                    last_updated: Utc::now(),
                },
            );
        }

        changes
    }

    pub async fn is_in_proximity(&self, space_id: Uuid, user1: Uuid, user2: Uuid) -> bool {
        let spaces = self.spaces.read().await;
        if let Some(space) = spaces.get(&space_id) {
            if let Some(entry) = space.proximity_cache.get(&user1) {
                return entry.peers.contains(&user2);
            }
        }
        false
    }

    pub async fn get_proximity_last_updated(&self, space_id: Uuid, user_id: Uuid) -> Option<DateTime<Utc>> {
        let spaces = self.spaces.read().await;
        if let Some(space) = spaces.get(&space_id) {
            space.proximity_cache.get(&user_id).map(|e| e.last_updated)
        } else {
            None
        }
    }
}
