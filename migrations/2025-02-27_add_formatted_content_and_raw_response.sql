-- Add formatted_content column to conversations table
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS formatted_content TEXT;

-- Add raw_response column to conversations table 
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS raw_response JSONB;

-- Create index on session_id for better query performance
CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
