# Gather Clone - Development Plan

## Project Overview

A production-quality MVP inspired by **Gather + Slack + Zoom** with true proximity-based audio/video communication.

### Core Features
- **Activity Mode**: 2D map navigation with proximity-based A/V (full-bleed map; COMMS HUD as a collapsible overlay)
- **Chat Mode**: Slack-like channel-based messaging (fixed channels, REST history + WebSocket live)
- **Meetings Mode**: Full-space video grid (non-proximity); uses the same in-memory WebRTC peer layer as Activity—no separate meeting server or SFU

### Doc freshness (code-aligned)

This plan is maintained to match [`apps/server/`](apps/server/) and [`apps/web/`](apps/web/). Notable implementation facts: **space join is implicit on WebSocket open** (query params), not a `client.join` message; Activity uses a **DOM tile grid** at **64px** per map cell (see `TILE_SIZE` in `activity/page.tsx`); chat has **no virtualized list** yet; **Main Office** is ensured on **every server start** via `db::ensure_main_office` plus optional `POST /api/dev/seed`; **Meetings** uses **`client.av.scope` `space`** and server **`AvScope`** so full-space video is not limited by proximity (see [`APPLICATION_TRACKER.md`](APPLICATION_TRACKER.md)).

---

## Tech Stack (Locked)

### Backend
| Library | Purpose |
|---------|---------|
| axum | Web framework |
| tokio | Async runtime |
| tower, tower-http | Middleware (CORS) |
| tower-governor | REST rate limiting (per-route layer) |
| axum WS | WebSocket support |
| serde, serde_json | Serialization |
| sqlx (postgres) | Database |
| uuid, chrono | IDs and timestamps |
| jsonwebtoken | JWT authentication |
| dotenvy | Environment variables |
| tracing | Logging |
| thiserror | Error handling |

### Frontend
| Library | Purpose |
|---------|---------|
| Next.js App Router | React framework |
| TypeScript | Type safety |
| zustand | State management |
| Native WebSocket | Real-time communication |
| Native WebRTC | Peer-to-peer A/V |
| Tailwind CSS | Styling |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Meetings   │  │    Chat     │  │        Activity         │  │
│  │   (Grid)    │  │  (Slack)    │  │  (Map + Proximity A/V)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │   Zustand Store   │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              │               │               │                  │
│         REST API        WebSocket      WebRTC (P2P)             │
└──────────────┼───────────────┼───────────────┼──────────────────┘
               │               │               │
               └───────────────┼───────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                      Backend (Rust/Axum)                         │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  REST API   │  │   WebSocket     │  │  Signaling Relay    │  │
│  │  Handlers   │  │   Handler       │  │  (Offer/Answer/ICE) │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │    App State      │                        │
│                    │  (In-Memory)      │                        │
│                    │  - Presence       │                        │
│                    │  - Proximity      │                        │
│                    │  - Connections    │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │    PostgreSQL     │                        │
│                    └───────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Tables

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spaces (virtual offices)
CREATE TABLE spaces (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps (2D grid for each space)
CREATE TABLE maps (
    id UUID PRIMARY KEY,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT,
    width INT NOT NULL,
    height INT NOT NULL,
    tiles JSONB NOT NULL,      -- Flattened int array [width*height]
    blocked JSONB NOT NULL,    -- Array of blocked tile indices
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Zones (labeled areas on map)
CREATE TABLE zones (
    id UUID PRIMARY KEY,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT,
    x INT NOT NULL,
    y INT NOT NULL,
    w INT NOT NULL,
    h INT NOT NULL
);

-- Chat messages
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_chat_messages_space_channel ON chat_messages(space_id, channel, created_at DESC);
CREATE INDEX idx_maps_space ON maps(space_id);
CREATE INDEX idx_zones_space ON zones(space_id);
```

---

## Implementation Phases

### Phase 1: Infrastructure Setup ✅
- [x] Docker Compose for PostgreSQL
- [x] Backend project structure (Cargo.toml, modules)
- [x] Frontend project structure (Next.js, TypeScript)
- [x] Environment configuration

### Phase 2: Database & REST API ✅
- [x] Database migrations
- [x] User creation (guest auth)
- [x] Space **list** + **get by id** (`GET /api/spaces`, `GET /api/spaces/:id`) — no public `POST/PUT/DELETE` spaces API yet (spaces created via `ensure_main_office` / DB)
- [x] Map and zone data returned with space detail
- [x] Chat message read + WS send/persist path
- [x] JWT authentication

### Phase 3: WebSocket Foundation ✅
- [x] WebSocket handler setup
- [x] Connection management
- [x] Client authentication via token
- [x] Message routing infrastructure

### Phase 4: Real-time Presence ✅
- [x] Join/leave handling
- [x] Movement handling with validation
- [x] Presence broadcasting
- [x] Zone detection and updates

### Phase 5: Proximity System ✅
- [x] Proximity calculation algorithm
- [x] Hysteresis implementation (4 tiles in, 5 tiles out) 
- [x] Peer selection with MAX_PROXIMITY_PEERS cap
- [x] Proximity change detection and broadcasting

### Phase 6: Frontend Core UI ✅
- [x] Layout with navigation tabs
- [x] Zustand store setup
- [x] WebSocket provider (`WebSocketProvider.tsx` — primary client WS + WebRTC orchestration)
- [x] Activity page (DOM map viewport, not `<canvas>`)
- [x] Chat page
- [x] Meetings page

### Phase 7: Activity Map Rendering ✅
- [x] DOM world layer (`TILE_SIZE = 64` px per grid cell in [`activity/page.tsx`](apps/web/src/app/(app)/activity/page.tsx); asset spec in [`.agent/skills/pixelart/skill.md`](.agent/skills/pixelart/skill.md) still targets 32×32 art that can be scaled)
- [x] Tile / wall rendering (absolute-positioned blocks)
- [x] Zone overlays (styled rectangles + labels; kitchen/cafe/meeting/lounge heuristics by name)
- [x] Avatar rendering (directional pixel-style sprites; proximity coloring)
- [x] Camera follows self; nearby / self highlights
- [x] Keyboard movement (Arrow keys / WASD); invalid moves can receive `server.move.rejected`

### Phase 8: WebRTC Proximity A/V ✅
- [x] Local media acquisition
- [x] Enable/disable nearby A/V toggle
- [x] Peer connection management
- [x] Offer/Answer/ICE signaling
- [x] Remote stream rendering
- [x] Connection cleanup

### Phase 9: Chat System ✅
- [x] Channel sidebar
- [x] Message list (scrollable; **no** react-window / virtual scroll in current code)
- [x] Message input
- [x] Real-time message updates
- [x] Message persistence

### Phase 10: Meetings Mode ✅
- [x] Video grid layout (responsive 2×3-style grid)
- [x] Local `getUserMedia` into shared store `localStream` + **`client.av.scope` `space`** so WebRTC meshes with all other `space`-scoped users in the office (server relays signaling when **both** peers are `space`; capped client-side, e.g. 15 peers)
- [x] Mute / camera / leave controls (client-side)

---

## Detailed Specifications

### Proximity Constants

```rust
const RADIUS_TILES: i32 = 4;           // Enter proximity at <= 4 tiles
const HYSTERESIS_OUT_TILES: i32 = 5;   // Leave proximity at > 5 tiles
const MAX_PROXIMITY_PEERS: usize = 6;  // Maximum concurrent A/V peers
const PROXIMITY_SIGNAL_GRACE_MS: u64 = 3000; // Grace period for signaling
```

### Proximity Algorithm

```
For each user U in space:
  1. Get all other users in space
  2. Calculate distance to each user V: sqrt((Ux-Vx)² + (Uy-Vy)²)
  3. Determine proximity set:
     - If V was NOT in U's proximity:
       - Add V if distance <= RADIUS_TILES
     - If V WAS in U's proximity:
       - Remove V only if distance > HYSTERESIS_OUT_TILES
  4. If |proximity_set| > MAX_PROXIMITY_PEERS:
     - Sort by distance ASC, then user_id ASC
     - Take first MAX_PROXIMITY_PEERS
  5. If proximity_set changed, send server.proximity to U
```

### WebSocket Connection (join is implicit)

The client does **not** send `client.join`. After JWT auth, it opens:

`GET /ws?token=<JWT>&space_id=<UUID>`

On upgrade, [`apps/server/src/ws.rs`](apps/server/src/ws.rs) loads the space into cache, calls `add_client`, and sends **`server.joined`** immediately. The space is fixed for the lifetime of that socket.

### WebSocket Message Types

#### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `client.move` | `{ x, y, dir }` | Move avatar |
| `client.chat.send` | `{ channel, body }` | Send chat message |
| `client.av.scope` | `{ scope: "proximity" \| "space" }` | Activity → `proximity` (nearby mesh); Meetings → `space` (full-office mesh with others in `space`) |
| `client.webrtc.offer` | `{ to_user_id, sdp }` | WebRTC offer |
| `client.webrtc.answer` | `{ to_user_id, sdp }` | WebRTC answer |
| `client.webrtc.ice` | `{ to_user_id, candidate }` | ICE candidate |

#### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `server.joined` | `{ self, space, map, zones, presence, av_scopes }` | Initial state after connect; `av_scopes` maps `user_id` → `"proximity"` \| `"space"` |
| `server.presence.update` | `{ user_id, x, y, dir, zone_id, display_name? }` | User moved / joined broadcast |
| `server.presence.snapshot` | `{ presence: [...] }` | Full roster sync (e.g. after join) |
| `server.presence.leave` | `{ user_id }` | User left |
| `server.proximity` | `{ peers: UUID[] }` | Proximity list update |
| `server.av.scope_changed` | `{ user_id, scope }` | A user switched Meetings vs Activity A/V mode |
| `server.move.rejected` | `{ reason }` | Move blocked (wall / bounds) |
| `server.chat.new` | `{ id, channel, user_id, display_name, body, created_at }` | New message |
| `server.webrtc.offer` | `{ from_user_id, sdp }` | Forwarded offer |
| `server.webrtc.answer` | `{ from_user_id, sdp }` | Forwarded answer |
| `server.webrtc.ice` | `{ from_user_id, candidate }` | Forwarded ICE |

### WebRTC Connection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    WHO INITIATES (Deterministic)                 │
│                                                                  │
│   Rule: Lower user_id (lexicographic) creates the offer         │
│                                                                  │
│   if (self.user_id < peer.user_id) {                            │
│       // Self is initiator - create and send offer              │
│   } else {                                                       │
│       // Self waits for offer from peer                         │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     CONNECTION SEQUENCE                          │
│                                                                  │
│  User A (lower ID)              Server              User B       │
│       │                           │                     │        │
│       │──── server.proximity ─────│                     │        │
│       │     [includes B]          │                     │        │
│       │                           │                     │        │
│       │                           │──── server.proximity│        │
│       │                           │     [includes A]    │        │
│       │                           │                     │        │
│       │ createOffer()             │                     │        │
│       │ setLocalDescription()     │                     │        │
│       │                           │                     │        │
│       │── client.webrtc.offer ───>│                     │        │
│       │   {to: B, sdp}            │                     │        │
│       │                           │── server.webrtc.offer│       │
│       │                           │   {from: A, sdp}    │        │
│       │                           │                     │        │
│       │                           │     setRemoteDescription()   │
│       │                           │     createAnswer()           │
│       │                           │     setLocalDescription()    │
│       │                           │                     │        │
│       │                           │<─ client.webrtc.answer       │
│       │                           │   {to: A, sdp}      │        │
│       │<─ server.webrtc.answer ───│                     │        │
│       │   {from: B, sdp}          │                     │        │
│       │                           │                     │        │
│       │ setRemoteDescription()    │                     │        │
│       │                           │                     │        │
│       │<──────── ICE Candidates exchanged ──────────────│        │
│       │                           │                     │        │
│       │◄═══════════ P2P Media Connected ════════════════│        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                   A/V STATE MACHINE                              │
│                                                                  │
│  ┌──────────────┐                                               │
│  │   DISABLED   │◄────────────────────────────────┐             │
│  │              │                                  │             │
│  │ No local     │    User clicks                  │ User clicks │
│  │ media        │    "Enable Nearby A/V"          │ "Disable"   │
│  │              │                                  │             │
│  └──────┬───────┘                                  │             │
│         │                                          │             │
│         ▼                                          │             │
│  ┌──────────────┐                                  │             │
│  │   ENABLING   │                                  │             │
│  │              │                                  │             │
│  │ Acquiring    │                                  │             │
│  │ getUserMedia │                                  │             │
│  │              │                                  │             │
│  └──────┬───────┘                                  │             │
│         │ Success                                  │             │
│         ▼                                          │             │
│  ┌──────────────┐      server.proximity           │             │
│  │   ENABLED    │◄─────────────────────┐          │             │
│  │              │                       │          │             │
│  │ Local media  │   Proximity changes   │          │             │
│  │ active       ├──────────────────────►│          │             │
│  │              │                                  │             │
│  │ Managing     │                                  │             │
│  │ peer         │──────────────────────────────────┘             │
│  │ connections  │                                               │
│  │              │                                               │
│  └──────────────┘                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              PEER CONNECTION MANAGEMENT                          │
│                                                                  │
│  On server.proximity { peers: [...] }:                          │
│                                                                  │
│  desiredPeers = new Set(peers)                                  │
│  currentPeers = new Set(peerConnections.keys())                 │
│                                                                  │
│  // Connect to new peers                                        │
│  for (peer of desiredPeers) {                                   │
│      if (!currentPeers.has(peer)) {                             │
│          createPeerConnection(peer)                             │
│      }                                                          │
│  }                                                              │
│                                                                  │
│  // Disconnect from removed peers                               │
│  for (peer of currentPeers) {                                   │
│      if (!desiredPeers.has(peer)) {                             │
│          closePeerConnection(peer)                              │
│      }                                                          │
│  }                                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Test Scenarios

### Scenario 1: Basic Authentication
```
Given: User opens the app
When: User enters display name and clicks "Join as Guest"
Then: 
  - JWT token is created and stored
  - User is redirected to space selection
  - User can see available spaces
```

### Scenario 2: Main Office (seed / bootstrap)
```
Given: User is authenticated
When: User clicks the home action that POSTs /api/dev/seed (e.g. ensure Main Office)
Then:
  - Server runs idempotent db::ensure_main_office (same as on server startup in main.rs)
  - Space list refreshes; Main Office appears
  - UI shows success or error text (not silent failure)
Note: Main Office is already created when the API process starts after migrations; the button is for manual refresh or empty-DB edge cases.
```

### Scenario 3: Join Activity Mode
```
Given: User is authenticated and space exists
When: User clicks on a space to join (or lands on Meetings/Chat/Activity with ?space=)
Then:
  - WebSocket opens to /ws?token=...&space_id=...
  - server.joined message received immediately
  - Map rendered with zones
  - User avatar appears at spawn point
  - Other users' avatars visible
```

### Scenario 4: Avatar Movement
```
Given: User is in Activity mode
When: User presses Arrow keys or WASD
Then:
  - client.move sent to server
  - Server validates bounds and blocked tiles
  - If valid, server.presence.update broadcast to all
  - If invalid, server.move.rejected to that client only
  - Avatar position updates on all clients when valid
```

### Scenario 5: Proximity Detection (Enter)
```
Given: User A at (5,5), User B at (15,5)
When: User A moves to (10,5) [distance = 5 tiles]
Then:
  - Distance <= RADIUS_TILES (4)? No
  - No proximity change
  
When: User A moves to (11,5) [distance = 4 tiles]
Then:
  - Distance <= RADIUS_TILES (4)? Yes
  - server.proximity sent to both A and B
  - Both receive peers list including each other
```

### Scenario 6: Proximity Detection (Exit with Hysteresis)
```
Given: User A and B are in proximity at distance 4
When: User A moves to distance 5 tiles
Then:
  - Distance > HYSTERESIS_OUT_TILES (5)? No (5 is not > 5)
  - Proximity maintained (no change)
  
When: User A moves to distance 6 tiles
Then:
  - Distance > HYSTERESIS_OUT_TILES (5)? Yes
  - server.proximity sent with peer removed
  - WebRTC connection closes
```

### Scenario 7: WebRTC Connection Establishment
```
Given: Users A (id: "aaa...") and B (id: "bbb...") become proximate
       A has lower user_id
When: server.proximity received by both
Then:
  - A creates RTCPeerConnection
  - A adds local tracks
  - A creates offer, sets local description
  - A sends client.webrtc.offer to B
  - B receives server.webrtc.offer from A
  - B creates RTCPeerConnection, adds local tracks
  - B sets remote description (offer)
  - B creates answer, sets local description
  - B sends client.webrtc.answer to A
  - A receives server.webrtc.answer from B
  - A sets remote description (answer)
  - ICE candidates exchanged
  - Media streams connected
  - Both see each other's video/audio
```

### Scenario 8: Enable/Disable Nearby A/V
```
Given: User is in Activity mode with A/V disabled
When: User clicks "Enable Nearby A/V"
Then:
  - getUserMedia called for audio+video
  - Local preview shows
  - If proximate peers exist, connections established
  
When: User clicks "Disable Nearby A/V"
Then:
  - All peer connections closed
  - Local media tracks stopped
  - Video tiles removed
  - Proximity list still updates (but no connections)
```

### Scenario 9: Max Peers Cap
```
Given: User A has 7 users within proximity range
When: Proximity calculated
Then:
  - Sort by distance ASC, user_id ASC for ties
  - Take first 6 peers (MAX_PROXIMITY_PEERS)
  - server.proximity contains only 6 peers
  - Only 6 WebRTC connections established
```

### Scenario 10: Chat Messaging
```
Given: User is in Chat mode in a space
When: User types message and sends to #general channel
Then:
  - client.chat.send sent via WebSocket
  - Message persisted to database
  - server.chat.new broadcast to all users in space
  - Message appears in all clients' chat UI
```

### Scenario 11: WebSocket Reconnection
```
Given: User is connected with active proximity peers
When: WebSocket disconnects unexpectedly (non-normal close)
Then:
  - Frontend clears peer connections
  - After a fixed delay (e.g. 2s), client opens a new WebSocket with same token + space_id (reconnect tick)
  - On connect, server sends server.joined and presence snapshot / proximity as today
  - Peer connections re-established when A/V enabled and server.proximity lists peers
Note: Current client does not implement exponential backoff; it uses a single retry interval.
```

### Scenario 12: Signaling Grace Period
```
Given: Users A and B are connected via WebRTC
When: A moves out of proximity (>5 tiles)
Then:
  - server.proximity sent without B
  - Signaling still allowed for PROXIMITY_SIGNAL_GRACE_MS (3000ms)
  - After 3s, signaling messages dropped
```

### Scenario 13: Zone Detection
```
Given: Map has zone "Meeting Room A" at (2,2,4,4)
When: User moves to position (3,3)
Then:
  - Server detects user is in zone
  - server.presence.update includes zone_id
  - UI highlights current zone
```

### Scenario 14: Multiple Browser Windows
```
Given: Same user opens app in two browser windows
When: User logs in with same name in both
Then:
  - Two separate user records created (guest auth)
  - Two separate WebSocket connections
  - Two avatars visible on map
  - Each can see and connect to the other
```

### Scenario 15: User Leaves Space
```
Given: Users A, B, C in space, A and B proximate
When: User A closes browser/disconnects
Then:
  - Server detects WebSocket close
  - server.presence.leave sent to B and C
  - B's peer connection to A closed
  - A's avatar removed from map
  - Proximity recalculated for remaining users
```

---

## API Reference

### REST Endpoints

#### POST /api/auth/guest
Create a guest user account.

**Request:**
```json
{
  "display_name": "John Doe"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "display_name": "John Doe"
  }
}
```

#### GET /api/spaces
List all available spaces.

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Main Office"
  }
]
```

#### GET /api/spaces/:id
Get space details including map and zones.

**Response:**
```json
{
  "space": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Main Office"
  },
  "map": {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "name": "Office Floor",
    "width": 20,
    "height": 15,
    "tiles": [1, 1, 1, ...],
    "blocked": [0, 1, 2, 19, 20, ...]
  },
  "zones": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "name": "Meeting Room A",
      "x": 2,
      "y": 2,
      "w": 4,
      "h": 4
    }
  ]
}
```

#### GET /api/chat/:space_id?channel=general
Get last 50 chat messages for a channel.

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440010",
    "channel": "general",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "display_name": "John Doe",
    "body": "Hello everyone!",
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

#### POST /api/dev/seed
Idempotent: ensures **Main Office** with default map and zones (same as [`db::ensure_main_office`](apps/server/src/db.rs) invoked from [`main.rs`](apps/server/src/main.rs) after migrations). **Not** gated on `RUST_ENV=production` in current code—safe to call for “refresh list” UX; rate limiting still applies with other `/api` routes.

**Response:**
```json
{
  "space_id": "550e8400-e29b-41d4-a716-446655440001"
}
```

#### Other routes
- `GET /health` — liveness
- `GET /ready` — DB connectivity
- WebSocket: `GET /ws` (not under `/api`)

---

## File Structure

```
gather-clone/
├── apps/
│   ├── server/
│   │   ├── Cargo.toml
│   │   ├── Cargo.lock
│   │   ├── .env
│   │   ├── migrations/
│   │   │   └── 001_initial.sql
│   │   └── src/
│   │       ├── main.rs
│   │       ├── auth.rs
│   │       ├── db.rs
│   │       ├── error.rs
│   │       ├── state.rs
│   │       ├── ws.rs
│   │       └── handlers/
│   │           ├── mod.rs
│   │           ├── auth.rs
│   │           ├── chat.rs
│   │           ├── dev.rs
│   │           └── spaces.rs
│   │
│   └── web/
│       ├── package.json
│       ├── next.config.js
│       ├── tailwind.config.js
│       ├── tsconfig.json
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── page.tsx
│           │   ├── globals.css
│           │   └── (app)/
│           │       ├── layout.tsx   # nav shell, h-dvh, WebSocketProvider
│           │       ├── activity/
│           │       │   └── page.tsx # map + COMMS overlay (all UI inline)
│           │       ├── chat/
│           │       │   └── page.tsx
│           │       └── meetings/
│           │           └── page.tsx
│           ├── hooks/
│           │   ├── WebSocketProvider.tsx  # primary WS + WebRTC
│           │   └── useWebSocket.ts        # alternate / legacy hook
│           └── store/
│               └── index.ts
│
├── packages/
│   └── shared/
│       ├── package.json
│       └── types.ts
│
├── infra/
│   └── docker-compose.yml
│
├── README.md
└── DEVELOPMENT_PLAN.md
```

---

## Running the Application

### Prerequisites
- Docker & Docker Compose
- Rust (latest stable)
- Node.js 18+
- npm or yarn

### Steps

1. **Start Database**
   ```bash
   cd infra
   docker compose up -d
   ```

2. **Start Backend**
   ```bash
   cd apps/server
   cargo run
   ```

3. **Start Frontend**
   ```bash
   cd apps/web
   npm install
   npm run dev
   ```

4. **Access Application**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:8080

---

## Known Limitations (MVP)

1. **No persistent user accounts** - Guest auth only
2. **Single STUN server** - No TURN for NAT traversal
3. **No screen sharing** - Audio/video only
4. **No meeting recordings**
5. **No file uploads in chat**
6. **No user avatars/profile pictures** (pixel sprites are generated from presence, not uploads)
7. **Chat history** - Last 50 messages per channel load (`get_chat_messages` limit); no virtualized infinite scroll
8. **Meetings** - Not a dedicated conferencing backend; relies on same P2P mesh as Activity for peers in the space
9. **Mobile** - Layout uses `h-dvh` and desktop-oriented HUD; not fully tuned for small screens
10. **No end-to-end encryption**

---

## Future Enhancements

1. OAuth integration (Google, GitHub)
2. TURN server for better connectivity
3. Screen sharing
4. Meeting recordings
5. File attachments in chat
6. Virtualized or paginated chat history (beyond last 50)
7. `POST /api/spaces` (and true CRUD) for user-created offices
8. Custom avatars
9. Mobile app (React Native)
10. E2E encryption
11. Space permissions/roles
12. Meeting scheduling
