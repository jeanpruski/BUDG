-- Keep all existing budgets and archives; only extend compatible payload types.
DO $migration$
DECLARE legacy_check record;
BEGIN
  FOR legacy_check IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'budg_state'::regclass AND contype = 'c'
    AND position('''version''' IN pg_get_constraintdef(oid)) > 0
  LOOP EXECUTE format('ALTER TABLE budg_state DROP CONSTRAINT %I', legacy_check.conname); END LOOP;
  ALTER TABLE budg_state ADD CONSTRAINT budg_state_version_check CHECK ((data->>'version')::integer IN (4,5,6,7,8,9,10));
  FOR legacy_check IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'budg_audit'::regclass AND contype = 'c'
    AND position('entity_type' IN pg_get_constraintdef(oid)) > 0
  LOOP EXECUTE format('ALTER TABLE budg_audit DROP CONSTRAINT %I', legacy_check.conname); END LOOP;
  ALTER TABLE budg_audit ADD CONSTRAINT budg_audit_entity_type_check
    CHECK (entity_type IN ('expense','payment','potExpense','potTransfer','billClosure','envelopeMonth','advancePayment','advanceUse','scheduledExpense'));
END
$migration$;
