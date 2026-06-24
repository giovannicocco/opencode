CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_power_runs INTEGER NOT NULL,
  monthly_fast_runs INTEGER NOT NULL,
  sponsor_enabled INTEGER NOT NULL DEFAULT 1,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  billing_price_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  provider_price_id TEXT,
  status TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription ON subscriptions(provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON billing_events(event_type);

INSERT OR IGNORE INTO plans (
  id,
  name,
  monthly_power_runs,
  monthly_fast_runs,
  sponsor_enabled,
  monthly_price_cents,
  billing_price_id
) VALUES (
  'free',
  'Free',
  10,
  40,
  1,
  0,
  NULL
);

INSERT OR IGNORE INTO plans (
  id,
  name,
  monthly_power_runs,
  monthly_fast_runs,
  sponsor_enabled,
  monthly_price_cents,
  billing_price_id
) VALUES (
  'pro',
  'Pro',
  200,
  1000,
  0,
  1900,
  NULL
);
