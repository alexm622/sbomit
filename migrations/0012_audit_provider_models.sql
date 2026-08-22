-- Track the provider config IDs and models used for each audit report.
-- Stored as a JSON array of objects: [{"providerId":"...","model":"..."}].
ALTER TABLE audit_reports ADD COLUMN provider_models TEXT;
