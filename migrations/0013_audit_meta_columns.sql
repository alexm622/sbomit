-- Track cache status, overall timing, and cache-hit counters for each audit report.
ALTER TABLE audit_reports ADD COLUMN cached INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_reports ADD COLUMN cache_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_reports ADD COLUMN started_at TEXT;
ALTER TABLE audit_reports ADD COLUMN finished_at TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_reports_cached ON audit_reports(cached);
CREATE INDEX IF NOT EXISTS idx_audit_reports_started_at ON audit_reports(started_at);
