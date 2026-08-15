-- Total LLM tokens consumed for this audit report (input + output across all interactions).
ALTER TABLE audit_reports ADD COLUMN tokens_total INTEGER;
