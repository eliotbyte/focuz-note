DROP INDEX IF EXISTS idx_filters_user_client_id;
DROP INDEX IF EXISTS idx_note_user_client_id;
ALTER TABLE filters DROP COLUMN IF EXISTS client_id;
ALTER TABLE note DROP COLUMN IF EXISTS client_id;
