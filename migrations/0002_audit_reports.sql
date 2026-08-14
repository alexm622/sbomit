-- Persisted audit reports: full structured output from the AI audit.
CREATE TABLE IF NOT EXISTS audit_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  prompt TEXT,
  model TEXT NOT NULL,
  score INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_reports_audit_id ON audit_reports(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_reports_public_id ON audit_reports(public_id);
