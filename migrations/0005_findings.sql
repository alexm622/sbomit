-- Normalized storage for audit findings so history can be queried and browsed
-- without parsing result_json.

CREATE TABLE IF NOT EXISTS audit_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_risks_report_id ON audit_risks(report_id);

CREATE TABLE IF NOT EXISTS audit_cves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  cve_id TEXT NOT NULL,
  aliases TEXT,                       -- JSON array of alias strings
  severity TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  published TEXT,
  modified TEXT,
  fixed_version TEXT,
  references_json TEXT,
  FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_cves_report_id ON audit_cves(report_id);

CREATE TABLE IF NOT EXISTS audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  area TEXT NOT NULL,
  file TEXT NOT NULL,
  issue TEXT NOT NULL,
  evidence TEXT,
  severity TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_findings_report_id ON audit_findings(report_id);

CREATE TABLE IF NOT EXISTS audit_investigation_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  area TEXT NOT NULL,
  rationale TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_investigation_areas_report_id ON audit_investigation_areas(report_id);

CREATE TABLE IF NOT EXISTS audit_investigation_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER NOT NULL,
  file TEXT NOT NULL,
  FOREIGN KEY (area_id) REFERENCES audit_investigation_areas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_investigation_files_area_id ON audit_investigation_files(area_id);

CREATE TABLE IF NOT EXISTS audit_report_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  license TEXT NOT NULL,
  transitive INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_report_dependencies_report_id ON audit_report_dependencies(report_id);
