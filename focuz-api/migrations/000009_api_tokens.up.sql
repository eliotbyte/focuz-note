-- Personal API tokens for agents and scripts (MCP, REST). Only a SHA-256 hash of a token is stored.
-- Additive: no existing rows change.
CREATE TABLE IF NOT EXISTS api_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  scope VARCHAR(8) NOT NULL CHECK (scope IN ('read', 'write')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  revoked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
