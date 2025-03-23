use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

// Proximity constants
pub const RADIUS_TILES: i32 = 4;
pub const HYSTERESIS_OUT_TILES: i32 = 5;
pub const MAX_PROXIMITY_PEERS: usize = 6;
pub const PROXIMITY_SIGNAL_GRACE_MS: u64 = 3000;

// Bounded channel capacity
pub const CHANNEL_CAPACITY: usize = 100;

// Spatial grid cell size (should be >= HYSTERESIS_OUT_TILES for efficiency)
const GRID_CELL_SIZE: i32 = 5;

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
#[allow(dead_code)]
pub struct ClientConnection {
    pub user_id: Uuid,
    pub display_name: String,
    pub space_id: Uuid,
    pub sender: mpsc::Sender<String>,
}

#[derive(Debug, Clone)]
pub struct ProximityEntry {
    pub peers: HashSet<Uuid>,
    pub last_updated: DateTime<Utc>,
}

/// Cached map data to avoid repeated DB queries
#[derive(Debug, Clone)]
pub struct CachedMapData {
    pub width: i32,
    pub height: i32,
    pub blocked: HashSet<i32>,
}

/// Cached zone data
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CachedZone {
    pub id: Uuid,
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Spatial grid for O(1) proximity lookups
#[derive(Debug, Default)]
pub struct SpatialGrid {
    cells: HashMap<(i32, i32), HashSet<Uuid>>,
}

impl SpatialGrid {
    fn get_cell_coords(x: i32, y: i32) -> (i32, i32) {
        (x / GRID_CELL_SIZE, y / GRID_CELL_SIZE)
    }

    pub fn insert(&mut self, user_id: Uuid, x: i32, y: i32) {
        let cell = Self::get_cell_coords(x, y);
        self.cells.entry(cell).or_default().insert(user_id);
    }

    pub fn remove(&mut self, user_id: Uuid, x: i32, y: i32) {
        let cell = Self::get_cell_coords(x, y);
        if let Some(users) = self.cells.get_mut(&cell) {
            users.remove(&user_id);
            if users.is_empty() {
                self.cells.remove(&cell);
            }
        }
    }

    pub fn update(&mut self, user_id: Uuid, old_x: i32, old_y: i32, new_x: i32, new_y: i32) {
        let old_cell = Self::get_cell_coords(old_x, old_y);
        let new_cell = Self::get_cell_coords(new_x, new_y);

        if old_cell != new_cell {
            self.remove(user_id, old_x, old_y);
            self.insert(user_id, new_x, new_y);
        }
    }

    /// Get users in nearby cells (within proximity range)
    pub fn get_nearby_users(&self, x: i32, y: i32) -> HashSet<Uuid> {
        let (cx, cy) = Self::get_cell_coords(x, y);
        let mut result = HashSet::new();

        // Check current cell and all adjacent cells (3x3 grid)
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(users) = self.cells.get(&(cx + dx, cy + dy)) {
                    result.extend(users.iter().copied());
                }
            }
        }

        result
    }
}

#[derive(Debug)]
pub struct SpaceState {
    pub clients: HashMap<Uuid, ClientConnection>,
    pub presence: HashMap<Uuid, UserPresence>,
    pub proximity_cache: HashMap<Uuid, ProximityEntry>,
    pub spatial_grid: SpatialGrid,
    pub cached_map: Option<CachedMapData>,
    pub cached_zones: Vec<CachedZone>,
}

impl SpaceState {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            presence: HashMap::new(),
            proximity_cache: HashMap::new(),
            spatial_grid: SpatialGrid::default(),
            cached_map: None,
            cached_zones: Vec::new(),
        }
    }
}

/// Pick a walkable tile not occupied by existing presence when map is cached; otherwise default.
/// Prefers tiles near map center so users are not stuck in a corner with only two exits.
fn pick_spawn_xy(space: &SpaceState) -> (i32, i32) {
    let Some(map) = space.cached_map.as_ref() else {
        return (5, 5);
    };
    let occupied: HashSet<(i32, i32)> = space.presence.iter().map(|(_, p)| (p.x, p.y)).collect();
    let y_end = map.height.saturating_sub(1).max(1);
    let x_end = map.width.saturating_sub(1).max(1);
    let cx = map.width / 2;
    let cy = map.height / 2;
    let mut candidates: Vec<(i32, i32, i32)> = Vec::new();
    for y in 1..y_end {
        for x in 1..x_end {
            let idx = y * map.width + x;
            if map.blocked.contains(&idx) {
                continue;
            }
            if occupied.contains(&(x, y)) {
                continue;
            }
            let dx = x - cx;
            let dy = y - cy;
            let dist2 = dx * dx + dy * dy;
            candidates.push((dist2, x, y));
        }
    }
    candidates.sort_by_key(|(d2, _, _)| *d2);
    if let Some((_, x, y)) = candidates.first() {
        return (*x, *y);
    }
    (5, 5)
}

#[derive(Debug)]
pub struct AppState {
    pub pool: PgPool,
    pub spaces: DashMap<Uuid, Arc<RwLock<SpaceState>>>,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            spaces: DashMap::new(),
        }
    }

    pub async fn add_client(
        &self,
        space_id: Uuid,
        user_id: Uuid,
        display_name: String,
        sender: mpsc::Sender<String>,
    ) {
        let space_arc = self.spaces.entry(space_id).or_insert_with(|| Arc::new(RwLock::new(SpaceState::new()))).clone();
        let mut space = space_arc.write().await;

        let (init_x, init_y) = pick_spawn_xy(&space);

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
                x: init_x,
                y: init_y,
                dir: "down".to_string(),
                zone_id: None,
                last_seen: Utc::now(),
            },
        );

        // Add to spatial grid
        space.spatial_grid.insert(user_id, init_x, init_y);
    }

    pub async fn remove_client(&self, space_id: Uuid, user_id: Uuid) {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let mut space = space_arc.write().await;
            // Get position before removal for spatial grid
            if let Some(presence) = space.presence.get(&user_id) {
                let (px, py) = (presence.x, presence.y);
                space.spatial_grid.remove(user_id, px, py);
            }

            space.clients.remove(&user_id);
            space.presence.remove(&user_id);
            space.proximity_cache.remove(&user_id);

            // Remove this user from other users' proximity caches
            for entry in space.proximity_cache.values_mut() {
                entry.peers.remove(&user_id);
            }

            // Clean up empty spaces to prevent memory leaks
            if space.clients.is_empty() {
                drop(space);
                self.spaces.remove(&space_id);
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
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let mut space = space_arc.write().await;
            
            let mut update_spatial = false;
            let mut px = 0;
            let mut py = 0;
            
            if let Some(presence) = space.presence.get(&user_id) {
                if presence.x != x || presence.y != y {
                    px = presence.x;
                    py = presence.y;
                    update_spatial = true;
                }
            }
            
            if update_spatial {
                space.spatial_grid.update(user_id, px, py, x, y);
            }

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
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            space.presence.values().cloned().collect()
        } else {
            Vec::new()
        }
    }

    pub async fn get_client_sender(&self, space_id: Uuid, user_id: Uuid) -> Option<mpsc::Sender<String>> {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            space.clients.get(&user_id).map(|c| c.sender.clone())
        } else {
            None
        }
    }

    pub async fn broadcast_to_space(&self, space_id: Uuid, message: &str, exclude_user: Option<Uuid>) {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            for (uid, client) in &space.clients {
                if exclude_user != Some(*uid) {
                    // Use try_send to avoid blocking on slow clients
                    if let Err(e) = client.sender.try_send(message.to_string()) {
                        tracing::warn!("Failed to send message to client {}: {:?}", uid, e);
                    }
                }
            }
        }
    }

    /// Compute proximity using spatial grid for O(k) instead of O(n²)
    pub async fn compute_proximity(&self, space_id: Uuid) -> HashMap<Uuid, HashSet<Uuid>> {
        let space_arc = match self.spaces.get(&space_id) {
            Some(s) => s.clone(),
            None => return HashMap::new(),
        };
        let mut space = space_arc.write().await;

        let mut new_proximity: HashMap<Uuid, HashSet<Uuid>> = HashMap::new();

        // For each user, find nearby users using spatial grid
        let user_positions: Vec<(Uuid, i32, i32)> = space
            .presence
            .iter()
            .map(|(id, p)| (*id, p.x, p.y))
            .collect();

        for (user_id, x1, y1) in &user_positions {
            // Get potential nearby users from spatial grid
            let candidates = space.spatial_grid.get_nearby_users(*x1, *y1);
            let mut distances: Vec<(Uuid, f64)> = Vec::new();

            for other_id in candidates {
                if other_id == *user_id {
                    continue;
                }

                if let Some(other_presence) = space.presence.get(&other_id) {
                    let dx = (other_presence.x - *x1) as f64;
                    let dy = (other_presence.y - *y1) as f64;
                    let dist = (dx * dx + dy * dy).sqrt();

                    // Check if peer was previously in proximity
                    let was_in_proximity = space
                        .proximity_cache
                        .get(user_id)
                        .is_some_and(|entry| entry.peers.contains(&other_id));

                    // Hysteresis: enter at RADIUS_TILES, exit at HYSTERESIS_OUT_TILES
                    let in_range = if was_in_proximity {
                        dist <= HYSTERESIS_OUT_TILES as f64
                    } else {
                        dist <= RADIUS_TILES as f64
                    };

                    if in_range {
                        distances.push((other_id, dist));
                    }
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
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            if let Some(entry) = space.proximity_cache.get(&user1) {
                return entry.peers.contains(&user2);
            }
        }
        false
    }

    pub async fn get_proximity_last_updated(&self, space_id: Uuid, user_id: Uuid) -> Option<DateTime<Utc>> {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            space.proximity_cache.get(&user_id).map(|e| e.last_updated)
        } else {
            None
        }
    }

    /// Cache map data for a space
    pub async fn cache_map_data(&self, space_id: Uuid, map: CachedMapData) {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let mut space = space_arc.write().await;
            space.cached_map = Some(map);
        }
    }

    /// Cache zones for a space
    pub async fn cache_zones(&self, space_id: Uuid, zones: Vec<CachedZone>) {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let mut space = space_arc.write().await;
            space.cached_zones = zones;
        }
    }

    /// Get cached map data
    #[allow(dead_code)]
    pub async fn get_cached_map(&self, space_id: Uuid) -> Option<CachedMapData> {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            space.cached_map.clone()
        } else {
            None
        }
    }

    /// Get cached zones
    #[allow(dead_code)]
    pub async fn get_cached_zones(&self, space_id: Uuid) -> Vec<CachedZone> {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            space.cached_zones.clone()
        } else {
            Vec::new()
        }
    }

    /// Validate move against cached map data
    /// Returns error if space doesn't exist, map is not cached, or position is invalid
    pub async fn validate_move(&self, space_id: Uuid, x: i32, y: i32) -> Result<(), &'static str> {
        // Fail if space doesn't exist
        let space_arc = self.spaces.get(&space_id).ok_or("Space not found")?.clone();
        let space = space_arc.read().await;
        
        // Fail if map is not cached - this means the space setup is incomplete
        // The map should always be cached when a user joins via send_joined_message
        let map = space.cached_map.as_ref().ok_or("Map data not available")?;
        
        // Check bounds
        if x < 0 || x >= map.width || y < 0 || y >= map.height {
            return Err("Position out of bounds");
        }

        // Check blocked tiles
        let tile_index = y * map.width + x;
        if map.blocked.contains(&tile_index) {
            return Err("Position is blocked");
        }
        
        Ok(())
    }

    /// Find zone for position using cached data
    pub async fn find_zone_for_position(&self, space_id: Uuid, x: i32, y: i32) -> Option<Uuid> {
        if let Some(space_arc) = self.spaces.get(&space_id) {
            let space = space_arc.read().await;
            for zone in &space.cached_zones {
                if x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h {
                    return Some(zone.id);
                }
            }
        }
        None
    }
}
