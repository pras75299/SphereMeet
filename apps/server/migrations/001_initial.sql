-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spaces table
CREATE TABLE spaces (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps table
CREATE TABLE maps (
    id UUID PRIMARY KEY,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT,
    width INT NOT NULL,
    height INT NOT NULL,
    tiles JSONB NOT NULL,
    blocked JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Zones table
CREATE TABLE zones (
    id UUID PRIMARY KEY,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT,
    x INT NOT NULL,
    y INT NOT NULL,
    w INT NOT NULL,
    h INT NOT NULL
);

-- Chat messages table
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_chat_messages_space_channel ON chat_messages(space_id, channel, created_at DESC);
CREATE INDEX idx_maps_space ON maps(space_id);
CREATE INDEX idx_zones_space ON zones(space_id);
