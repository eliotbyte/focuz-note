-- Bumped when the password changes: login tokens issued before that stop working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
