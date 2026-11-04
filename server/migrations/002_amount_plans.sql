-- Accept the new amount-plan format while keeping existing V4 rows untouched.
-- Older releases can still read their own data until the V5 application writes it.
DO $migration$
DECLARE
  legacy_check record;
BEGIN
  FOR legacy_check IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'budg_state'::regclass
      AND contype = 'c'
      AND conname <> 'budg_state_version_check'
      AND position('''version''' IN pg_get_constraintdef(oid)) > 0
  LOOP
    EXECUTE format('ALTER TABLE budg_state DROP CONSTRAINT %I', legacy_check.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'budg_state'::regclass
      AND conname = 'budg_state_version_check'
  ) THEN
    ALTER TABLE budg_state ADD CONSTRAINT budg_state_version_check
      CHECK ((data->>'version')::integer IN (4, 5, 6));
  END IF;
END
$migration$;
