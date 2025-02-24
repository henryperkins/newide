-- Add composite indexes to optimize model stats queries

-- Composite index for model + timestamp queries (used in get_model_stats)
CREATE INDEX IF NOT EXISTS idx_model_usage_stats_model_timestamp
    ON model_usage_stats (model, timestamp);

-- Composite index for session_id + model queries (used in get_session_stats)
CREATE INDEX IF NOT EXISTS idx_model_usage_stats_session_model
    ON model_usage_stats (session_id, model);

-- Index for timestamp DESC sorting (optimizes time-based trend queries)
CREATE INDEX IF NOT EXISTS idx_model_usage_stats_timestamp_desc
    ON model_usage_stats (timestamp DESC);
