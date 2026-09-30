-- Client-generated ids make note/filter creation idempotent: a push that is retried after
-- a lost response maps to the row created by the first attempt instead of duplicating it.
-- Additive and nullable: existing rows are untouched.
ALTER TABLE note ADD COLUMN IF NOT EXISTS client_id VARCHAR(64);
ALTER TABLE filters ADD COLUMN IF NOT EXISTS client_id VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_user_client_id ON note(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_filters_user_client_id ON filters(user_id, client_id) WHERE client_id IS NOT NULL;
