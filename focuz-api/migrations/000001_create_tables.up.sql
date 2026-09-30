CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL CHECK (LENGTH(username) >= 3 AND LENGTH(username) <= 50),
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE role (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE space (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id INTEGER REFERENCES users(id),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE user_to_space (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    space_id INTEGER NOT NULL REFERENCES space(id),
    role_id INTEGER NOT NULL REFERENCES role(id),
    is_pending BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (user_id, space_id)
);

CREATE TABLE tag (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE tag_to_space (
    id SERIAL PRIMARY KEY,
    tag_id INTEGER NOT NULL REFERENCES tag(id),
    space_id INTEGER NOT NULL REFERENCES space(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (tag_id, space_id)
);

CREATE TABLE note (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW(),
    date TIMESTAMP NOT NULL DEFAULT NOW(),
    parent_id INTEGER REFERENCES note(id),
    reply_count INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE,
    space_id INTEGER NOT NULL REFERENCES space(id)
);


CREATE TABLE note_to_tag (
    id SERIAL PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES note(id),
    tag_id INTEGER NOT NULL REFERENCES tag(id),
    UNIQUE (note_id, tag_id)
);

CREATE TABLE activity_type_category (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE activity_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    value_type VARCHAR(50) NOT NULL,
    min_value DOUBLE PRECISION,
    max_value DOUBLE PRECISION,
    aggregation VARCHAR(50) NOT NULL,
    space_id INTEGER REFERENCES space(id),
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    unit VARCHAR(50),
    category_id INTEGER REFERENCES activity_type_category(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (name, space_id)
);

CREATE TABLE activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type_id INTEGER NOT NULL REFERENCES activity_types(id),
    value JSONB NOT NULL,
    note_id INTEGER REFERENCES note(id),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE attachments (
    id VARCHAR(36) PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES note(id),
    client_id VARCHAR(36),
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (note_id, client_id)
);

CREATE TABLE chart (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    space_id INTEGER NOT NULL REFERENCES space(id),
    kind INTEGER NOT NULL,
    activity_type_id INTEGER NOT NULL REFERENCES activity_types(id),
    period INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT,
    note_id INTEGER REFERENCES note(id),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    sticky BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP
);

-- Filters
CREATE TABLE filters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    space_id INTEGER NOT NULL REFERENCES space(id),
    parent_id INTEGER REFERENCES filters(id),
    name VARCHAR(255) NOT NULL,
    params JSONB NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_note_date ON note(date);
CREATE INDEX IF NOT EXISTS idx_note_created_at ON note(created_at);
CREATE INDEX IF NOT EXISTS idx_user_to_space_user_space ON user_to_space(user_id, space_id);
CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments(note_id);
CREATE INDEX IF NOT EXISTS idx_activities_note_id ON activities(note_id);
CREATE INDEX IF NOT EXISTS idx_activities_type_id ON activities(type_id);
CREATE INDEX IF NOT EXISTS idx_activity_types_space_id ON activity_types(space_id);
-- Additional helpful indexes
CREATE INDEX IF NOT EXISTS idx_tag_name ON tag(name);
CREATE INDEX IF NOT EXISTS idx_note_to_tag_note ON note_to_tag(note_id);
CREATE INDEX IF NOT EXISTS idx_note_to_tag_tag ON note_to_tag(tag_id);
-- Filter indexes
CREATE INDEX IF NOT EXISTS idx_filters_space_id ON filters(space_id);
CREATE INDEX IF NOT EXISTS idx_filters_parent_id ON filters(parent_id);
CREATE INDEX IF NOT EXISTS idx_filters_user_id ON filters(user_id);
