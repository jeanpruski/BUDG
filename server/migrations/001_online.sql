CREATE TABLE IF NOT EXISTS budg_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  password_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS budg_users_one_per_role ON budg_users(role);

CREATE TABLE IF NOT EXISTS budg_sessions (
  session_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES budg_users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS budg_sessions_expiry ON budg_sessions(expires_at);

CREATE TABLE IF NOT EXISTS budg_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL CHECK (revision >= 1),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((data->>'version')::integer = 4),
  CHECK ((data->>'revision')::bigint = revision)
);

CREATE TABLE IF NOT EXISTS budg_backups (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS budg_backups_order ON budg_backups(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS budg_login_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budg_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL,
  actor_email text NOT NULL,
  actor_display_name text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('expense', 'payment', 'potExpense')),
  entity_id text NOT NULL,
  entity_month text NOT NULL CHECK (entity_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  action text NOT NULL CHECK (action IN ('added', 'updated', 'deleted')),
  revision bigint NOT NULL,
  before_data jsonb,
  after_data jsonb,
  UNIQUE (revision, entity_type, entity_month, entity_id)
);
CREATE INDEX IF NOT EXISTS budg_audit_month ON budg_audit(entity_month, id DESC);

-- Transactional outbox: a disk failure must not lose the exact month-closing state.
CREATE TABLE IF NOT EXISTS budg_monthly_archives (
  month text PRIMARY KEY CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  snapshot jsonb NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision >= 1),
  finalized boolean NOT NULL DEFAULT false,
  published_revision bigint NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
  CHECK (published_revision <= source_revision),
  CHECK (snapshot->>'format' = 'BUDG_SERVER_BACKUP'),
  CHECK (snapshot->>'kind' = 'monthly'),
  CHECK (snapshot->>'month' = month),
  CHECK ((snapshot->'state'->>'revision')::bigint = source_revision)
);
