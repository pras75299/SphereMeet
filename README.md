# Spheremeet

A production-quality MVP inspired by Gather + Slack + Zoom with TRUE PROXIMITY AUDIO/VIDEO.

## Features

- **Activity Mode**: Virtual office map with proximity-based audio/video
- **Chat Mode**: Slack-like persistent chat with channels
- **Meetings Mode**: Video conferencing room (2x3 grid layout)
- **Real-time Presence**: See other users on the map
- **Proximity A/V**: Audio/video automatically connects when users are within 4 tiles
- **Hysteresis**: Connections stay active until users are more than 5 tiles apart (prevents flicker)

## Architecture

### Backend (Rust + Axum) = https://spheremeet.onrender.com

- REST API for auth, spaces, and chat history
- WebSocket for real-time presence, proximity updates, and WebRTC signaling
- PostgreSQL for persistence
- In-memory state for presence and proximity computation

### Frontend (Next.js + TypeScript) = https://sphere-meet-eosin.vercel.app

- Zustand for state management
- Native WebSocket for real-time communication
- Native WebRTC for peer-to-peer audio/video
- Tailwind CSS for styling

## Prerequisites

- Docker and Docker Compose
- Rust (1.70+)
- Node.js (18+)
- npm or yarn

## Quick Start

### 1. Start PostgreSQL

```bash
cd gather-clone/infra
docker compose up -d
```

### 2. Start the Backend

```bash
cd gather-clone/apps/server

# The .env file should already exist with:
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/gather_clone
# JWT_SECRET=dev_secret_change_me
# CORS_ORIGIN=http://localhost:3000

cargo run
```

The server will start at http://localhost:8080

### 3. Start the Frontend

```bash
cd gather-clone/apps/web

# Create .env.local if it doesn't exist
echo "NEXT_PUBLIC_API_BASE=http://localhost:8080" > .env.local

npm install
npm run dev
```

The frontend will start at http://localhost:3000

### 4. Create a Demo Space

1. Open http://localhost:3000
2. Enter a display name and click "Join as Guest"
3. Click "Create Demo Space" to seed the database with a sample space and map

## Production / Database URL

The backend reads configuration from **environment variables**; values in the environment override `.env`.

- **Where to set the production database URL**
  - **Option A:** Put a `.env` file in `apps/server/` with:
    ```bash
    DATABASE_URL=postgres://user:password@your-host:5432/your_database
    JWT_SECRET=your_secure_secret
    CORS_ORIGIN=https://your-frontend-domain.com
    ```
  - **Option B:** Set the same variables in the environment when running the server (e.g. systemd, Docker, or your host). No `.env` file is required.

- **Run the server** from `apps/server/` so `dotenvy` can find `.env` in the current directory:
  ```bash
  cd apps/server
  cargo run --release
  ```
- Copy `apps/server/.env.example` to `apps/server/.env` and fill in your values. Do not commit `.env` (it is gitignored).

## Deploy backend on Render

1. **New Web Service** → connect your repo.
2. **Root Directory:** `apps/server` (required).
3. **Environment:** Rust.
4. **Build Command:** `cargo build --release`
5. **Start Command:** `./target/release/gather-server`  
   Do not use `cargo run`; use the built binary so the server binds to Render’s `PORT`.
6. **Environment variables** (Dashboard → Environment):
   - `DATABASE_URL` – e.g. from Render Postgres (Internal URL).
   - `JWT_SECRET` – any long random string.
   - `CORS_ORIGIN` – your frontend URL (e.g. `https://your-app.onrender.com`).
7. Do **not** set `PORT`; Render sets it automatically.
8. Optional: **Health Check Path** = `/health`.

If you see “Port scan timeout” or “no open ports”, check the **Logs** tab. If you see “Connecting to database…” then the process is failing on DB connect or migrations (e.g. missing or wrong `DATABASE_URL`). If the Start Command is not exactly `./target/release/gather-server`, fix it and redeploy.

## Testing Proximity A/V

1. Open two browser windows at http://localhost:3000
2. Login with different names in each window
3. Go to Activity mode in both
4. Click "Enable Nearby A/V" in both windows
5. Move avatars within 4 tiles of each other → video/audio connects
6. Move away beyond 5 tiles → connection closes

## Project Structure

```
gather-clone/
├── apps/
│   ├── server/           # Rust backend
│   │   ├── migrations/   # SQL migrations
│   │   └── src/
│   │       ├── main.rs
│   │       ├── auth.rs   # JWT handling
│   │       ├── db.rs     # Database operations
│   │       ├── error.rs  # Error types
│   │       ├── state.rs  # In-memory state
│   │       ├── ws.rs     # WebSocket handler
│   │       └── handlers/ # REST API handlers
│   └── web/              # Next.js frontend
│       └── src/
│           ├── app/      # App Router pages
│           ├── hooks/    # Custom hooks
│           └── store/    # Zustand store
├── packages/
│   └── shared/           # Shared types
└── infra/
    └── docker-compose.yml
```

## API Reference

### REST Endpoints

| Method | Path                  | Description       |
| ------ | --------------------- | ----------------- |
| POST   | `/api/auth/guest`     | Create guest user |
| POST   | `/api/dev/seed`       | Seed demo space   |
| GET    | `/api/spaces`         | List all spaces   |
| GET    | `/api/spaces/:id`     | Get space details |
| GET    | `/api/chat/:space_id` | Get chat messages |

### WebSocket Messages

#### Client → Server

| Type                   | Description        |
| ---------------------- | ------------------ |
| `client.move`          | Move avatar        |
| `client.chat.send`     | Send chat message  |
| `client.webrtc.offer`  | Send WebRTC offer  |
| `client.webrtc.answer` | Send WebRTC answer |
| `client.webrtc.ice`    | Send ICE candidate |

#### Server → Client

| Type                     | Description             |
| ------------------------ | ----------------------- |
| `server.joined`          | Initial state on join   |
| `server.presence.update` | User position update    |
| `server.presence.leave`  | User left               |
| `server.proximity`       | Authoritative peer list |
| `server.chat.new`        | New chat message        |
| `server.webrtc.offer`    | Forwarded offer         |
| `server.webrtc.answer`   | Forwarded answer        |
| `server.webrtc.ice`      | Forwarded ICE candidate |

## Proximity Rules

- **RADIUS_TILES = 4**: Peers enter range at ≤4 tiles
- **HYSTERESIS_OUT_TILES = 5**: Peers leave range only when >5 tiles
- **MAX_PROXIMITY_PEERS = 6**: Hard cap on concurrent peer connections
- **PROXIMITY_SIGNAL_GRACE_MS = 3000**: Grace period for signaling after leaving proximity

## WebRTC Connection Logic

1. Server sends `server.proximity` with authoritative peer list
2. Client compares with current connections:
   - New peers → CONNECT
   - Missing peers → DISCONNECT
3. **Offer Initiation Rule**: Lower user_id (lexicographic) initiates
4. STUN server: `stun:stun.l.google.com:19302`

## License

MIT
