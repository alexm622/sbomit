-- Package audits: one row per audited library URL.
CREATE TABLE IF NOT EXISTS package_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  audited_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Direct dependencies of an audited package.
CREATE TABLE IF NOT EXISTS package_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  dependency_type TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_package_dependencies_audit_id ON package_dependencies(audit_id);
CREATE INDEX IF NOT EXISTS idx_package_audits_url ON package_audits(url);
