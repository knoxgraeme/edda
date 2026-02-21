-- Add title column to thread_metadata for display in the thread list.
ALTER TABLE thread_metadata ADD COLUMN IF NOT EXISTS title TEXT;
