-- Per-provider daily token limits and tracked usage.
CREATE TABLE IF NOT EXISTS provider_limits (
  provider_id TEXT PRIMARY KEY,
  daily_token_limit INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_usage (
  provider_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, usage_date),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_provider_id ON provider_usage(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_usage_date ON provider_usage(usage_date);
