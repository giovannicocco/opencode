CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  bearer_hash TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_balances (
  user_id TEXT PRIMARY KEY,
  power_runs_remaining INTEGER NOT NULL DEFAULT 10,
  fast_runs_remaining INTEGER NOT NULL DEFAULT 40,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('power', 'fast')),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'failed', 'refunded')),
  model_alias TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  notpixel_impression_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('power', 'fast')),
  amount INTEGER NOT NULL,
  source TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_created ON usage_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_status ON usage_ledger(status);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON credit_ledger(user_id, created_at);
