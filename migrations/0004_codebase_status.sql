-- Track whether the audit inspected the actual source code tarball.
ALTER TABLE audit_reports ADD COLUMN codebase_inspected INTEGER DEFAULT 0;
