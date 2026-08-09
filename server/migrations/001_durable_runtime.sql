CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY,
  user_ref char(64) NOT NULL,
  worker_address varchar(42) NOT NULL,
  platform_id bigint NOT NULL,
  state text NOT NULL,
  claim_id numeric(78, 0),
  circle_operation_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflows_user_ref_hash CHECK (user_ref ~ '^[0-9a-f]{64}$'),
  CONSTRAINT workflows_worker_address CHECK (worker_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT workflows_state CHECK (state IN (
    'wallet_ready', 'gas_ready', 'task_complete', 'claim_created',
    'claim_certified', 'awaiting_approval', 'arc_pending',
    'advance_confirmed', 'complete', 'cancelled'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS workflows_one_active_per_user
  ON workflows (user_ref) WHERE state NOT IN ('complete', 'cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS workflows_claim_id_unique
  ON workflows (claim_id) WHERE claim_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workflows_circle_operation_unique
  ON workflows (circle_operation_id) WHERE circle_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflows_user_updated_idx ON workflows (user_ref, updated_at DESC);

CREATE TABLE IF NOT EXISTS wallets (
  wallet_id text PRIMARY KEY,
  address varchar(42) NOT NULL UNIQUE,
  blockchain text NOT NULL,
  account_type text NOT NULL,
  circle_user_ref char(64) NOT NULL,
  public_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_user_ref_hash CHECK (circle_user_ref ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wallets_address CHECK (address ~ '^0x[0-9a-fA-F]{40}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS wallets_address_lower_unique ON wallets (lower(address));

CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  user_ref char(64) NOT NULL,
  workflow_id uuid REFERENCES workflows(id) ON DELETE SET NULL,
  operation_type text NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  status text NOT NULL,
  challenge_id text,
  transaction_id text,
  tx_hash varchar(66),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_user_ref_hash CHECK (user_ref ~ '^[0-9a-f]{64}$'),
  CONSTRAINT operations_tx_hash CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-fA-F]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS operations_transaction_id_unique
  ON operations (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS operations_active_purchase_per_workflow
  ON operations (workflow_id, operation_type)
  WHERE workflow_id IS NOT NULL AND operation_type = 'purchase_advance'
    AND status NOT IN ('transaction_failed', 'transaction_timed_out', 'cancelled');
CREATE INDEX IF NOT EXISTS operations_user_idx ON operations (user_ref, updated_at DESC);

CREATE TABLE IF NOT EXISTS budget_usage (
  budget_type text NOT NULL,
  period_start date NOT NULL,
  amount_units numeric(78, 0) NOT NULL DEFAULT 0,
  reservation_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_type, period_start),
  CONSTRAINT budget_usage_nonnegative CHECK (amount_units >= 0 AND reservation_count >= 0)
);

CREATE TABLE IF NOT EXISTS budget_reservations (
  budget_type text NOT NULL,
  period_start date NOT NULL,
  reservation_key text NOT NULL,
  amount_units numeric(78, 0) NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_type, period_start, reservation_key),
  CONSTRAINT budget_reservation_amount CHECK (amount_units >= 0),
  CONSTRAINT budget_reservation_status CHECK (status IN ('reserved', 'submitted', 'confirmed', 'released', 'failed'))
);

CREATE TABLE IF NOT EXISTS gas_seeds (
  wallet_id text PRIMARY KEY REFERENCES wallets(wallet_id) ON DELETE RESTRICT,
  worker_address varchar(42) NOT NULL UNIQUE,
  request_key_hash char(64),
  amount_units numeric(78, 0) NOT NULL DEFAULT 0,
  status text NOT NULL,
  transaction_hash varchar(66),
  public_receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gas_seed_request_hash CHECK (request_key_hash IS NULL OR request_key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT gas_seed_tx_hash CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  CONSTRAINT gas_seed_status CHECK (status IN ('reserved', 'submitted', 'confirmed', 'not_needed', 'failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS gas_seeds_worker_lower_unique ON gas_seeds (lower(worker_address));

CREATE UNIQUE INDEX IF NOT EXISTS gas_seeds_transaction_hash_unique
  ON gas_seeds (transaction_hash) WHERE transaction_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key_hash char(64) NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_hash, window_start),
  CONSTRAINT rate_limit_hash CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT rate_limit_count CHECK (request_count >= 0)
);
