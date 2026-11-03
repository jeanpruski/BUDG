-- Each event owns its immutable backup: retries never render a later budget.
CREATE TABLE IF NOT EXISTS budg_email_reports (
  id uuid PRIMARY KEY,
  event text NOT NULL CHECK (event IN ('monthly', 'closed')),
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  snapshot jsonb NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision >= 1),
  message_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event, month),
  CHECK (snapshot->>'format' = 'BUDG_SERVER_BACKUP'),
  CHECK (snapshot->>'kind' = 'monthly'),
  CHECK (snapshot->>'month' = month),
  CHECK ((snapshot->'state'->>'revision')::bigint = source_revision),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS budg_email_reports_pending
  ON budg_email_reports(next_attempt_at, created_at) WHERE status = 'pending';
