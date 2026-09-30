-- Server-generated settings, e.g. the JWT signing secret when JWT_SECRET is not set.
CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
