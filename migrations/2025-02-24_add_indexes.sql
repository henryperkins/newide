-- This SQL file adds indexes to the model_usage_stats table for better query performance.
-- Adjust the table name if needed, and ensure the table already exists.

-- Index on model, to quickly filter by model name
CREATE INDEX IF NOT EXISTS idx_model_usage_stats_model
    ON model_usage_stats (model);

-- Index on session_id, to quickly filter by session
CREATE INDEX IF NOT EXISTS idx_model_usage_stats_session_id
    ON model_usage_stats (session_id);

-- Index on timestamp, to speed up time-based queries
CREATE INDEX IF NOT EXISTS idx_model_usage_stats_timestamp
    ON model_usage_stats (timestamp);