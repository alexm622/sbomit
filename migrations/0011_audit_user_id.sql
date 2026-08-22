-- Associate each audit run with the user who initiated it.
ALTER TABLE package_audits ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_package_audits_user_id ON package_audits(user_id);
