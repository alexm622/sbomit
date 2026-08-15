-- Full structured audit reports keyed to package_audits.
CREATE TABLE IF NOT EXISTS audit_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  prompt TEXT,                  -- NULL when using the default prompt
  model TEXT NOT NULL,          -- e.g. "gpt-4o-mini"
  score INTEGER NOT NULL,
  result_json TEXT NOT NULL,    -- full validated AuditResult JSON
  cache_key TEXT UNIQUE,        -- dedupe key for identical audits
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_reports_audit_id ON audit_reports(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_reports_public_id ON audit_reports(public_id);
CREATE INDEX IF NOT EXISTS idx_audit_reports_cache_key ON audit_reports(cache_key);
