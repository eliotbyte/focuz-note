-- Space pictures and user avatars. They are small (the apps crop and resize them to 256x256 before
-- upload), so they live next to the row instead of in object storage.
ALTER TABLE space ADD COLUMN IF NOT EXISTS icon BYTEA;
ALTER TABLE space ADD COLUMN IF NOT EXISTS icon_type VARCHAR(32);
ALTER TABLE space ADD COLUMN IF NOT EXISTS icon_updated_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_type VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMP;
