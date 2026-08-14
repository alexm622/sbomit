-- Capture the full LLM interaction (prompts, request, response, timing, usage)
-- alongside each audit report for observability and debugging.
ALTER TABLE audit_reports ADD COLUMN interaction_json TEXT;
