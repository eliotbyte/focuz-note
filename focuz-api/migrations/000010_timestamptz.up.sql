-- Times become TIMESTAMPTZ: a value sent with an offset (2026-10-27T14:00:00+03:00) is stored as
-- the instant it names instead of losing the offset. Existing values were written as UTC.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp without time zone'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
      r.table_name, r.column_name, r.column_name);
  END LOOP;
END $$;
