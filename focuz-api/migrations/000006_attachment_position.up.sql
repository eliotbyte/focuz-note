-- Explicit order of images in a note. It used to be derived from modified_at, which the server
-- sets at upload time, so images uploaded out of order (retries, slow files) jumped around.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS position INTEGER;

UPDATE attachments a SET position = o.rn
FROM (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY note_id ORDER BY modified_at ASC, id ASC) - 1)::int AS rn
  FROM attachments
) o
WHERE a.id = o.id AND a.position IS NULL;
