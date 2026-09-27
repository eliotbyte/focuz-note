-- Shared spaces: roles, invitations, notifications settings, edit history and public links.
-- Additive: no rows are deleted except pending invitations, which move to space_invitations.

-- Roles: owner (one per space), admin, editor, guest (read-only).
INSERT INTO role (name) VALUES ('owner'), ('admin'), ('editor'), ('guest') ON CONFLICT (name) DO NOTHING;

-- Before this version an invited "guest" could write notes. Keep what they could do: make them editors.
UPDATE user_to_space
SET role_id = (SELECT id FROM role WHERE name = 'editor')
WHERE role_id = (SELECT id FROM role WHERE name = 'guest');

-- Personal space: the one created for the user at sign-up. It can't be shared with other people.
ALTER TABLE space ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE space s SET is_personal = TRUE
WHERE s.id = (SELECT MIN(s2.id) FROM space s2 WHERE s2.owner_id = s.owner_id AND s2.is_deleted = FALSE)
  AND NOT EXISTS (SELECT 1 FROM user_to_space u WHERE u.space_id = s.id AND u.user_id <> s.owner_id);

-- Who changed a note last, and a log of who edited it when.
ALTER TABLE note ADD COLUMN IF NOT EXISTS modified_by INTEGER REFERENCES users(id);
UPDATE note SET modified_by = user_id WHERE modified_by IS NULL;
CREATE TABLE IF NOT EXISTS note_edits (
    id SERIAL PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action VARCHAR(16) NOT NULL DEFAULT 'edited',
    edited_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_note_edits_note ON note_edits(note_id, edited_at DESC);

-- Invitations. identifier is what the inviter typed (username or e-mail); invitee_id is set only
-- when such an account exists. The inviter sees the same thing either way.
CREATE TABLE IF NOT EXISTS space_invitations (
    id SERIAL PRIMARY KEY,
    space_id INTEGER NOT NULL REFERENCES space(id),
    inviter_id INTEGER NOT NULL REFERENCES users(id),
    invitee_id INTEGER REFERENCES users(id),
    identifier VARCHAR(254) NOT NULL,
    role_id INTEGER NOT NULL REFERENCES role(id),
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    responded_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_space_invitations_pending
    ON space_invitations (space_id, LOWER(identifier)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_space_invitations_invitee ON space_invitations (invitee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_space_invitations_inviter ON space_invitations (inviter_id, created_at);

INSERT INTO space_invitations (space_id, inviter_id, invitee_id, identifier, role_id)
SELECT u.space_id, s.owner_id, u.user_id, us.username, (SELECT id FROM role WHERE name = 'editor')
FROM user_to_space u JOIN space s ON s.id = u.space_id JOIN users us ON us.id = u.user_id
WHERE u.is_pending = TRUE AND s.owner_id IS NOT NULL
ON CONFLICT DO NOTHING;
DELETE FROM user_to_space WHERE is_pending = TRUE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);

-- Public read-only links to a whole space (note_id NULL) or to a note (optionally with its replies).
CREATE TABLE IF NOT EXISTS public_links (
    id SERIAL PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    space_id INTEGER NOT NULL REFERENCES space(id),
    note_id INTEGER REFERENCES note(id),
    include_replies BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_links_active
    ON public_links (space_id, COALESCE(note_id, 0)) WHERE revoked_at IS NULL;
