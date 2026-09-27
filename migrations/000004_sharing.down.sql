DROP TABLE IF EXISTS public_links;
DROP INDEX IF EXISTS idx_notifications_user_created;
ALTER TABLE users DROP COLUMN IF EXISTS notify_email;
-- Pending invitations go back to the old place.
INSERT INTO user_to_space (user_id, space_id, role_id, is_pending)
SELECT invitee_id, space_id, role_id, TRUE FROM space_invitations
WHERE status = 'pending' AND invitee_id IS NOT NULL
ON CONFLICT (user_id, space_id) DO NOTHING;
DROP TABLE IF EXISTS space_invitations;
DROP TABLE IF EXISTS note_edits;
ALTER TABLE note DROP COLUMN IF EXISTS modified_by;
ALTER TABLE space DROP COLUMN IF EXISTS is_personal;
