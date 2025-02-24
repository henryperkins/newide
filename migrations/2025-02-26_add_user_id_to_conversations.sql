ALTER TABLE conversations
    ADD COLUMN user_id uuid;

ALTER TABLE conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL;