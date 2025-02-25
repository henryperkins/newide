BEGIN;

-- Create users table if not exists
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- Add missing model column to conversations
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS model VARCHAR(50);

-- Add foreign key constraint for user_id
ALTER TABLE conversations 
ADD CONSTRAINT fk_conversations_users
FOREIGN KEY (user_id) 
REFERENCES users(id)
ON DELETE SET NULL;

COMMIT;
