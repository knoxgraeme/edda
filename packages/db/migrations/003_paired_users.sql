-- Generalized user pairing table for cross-platform access control.
-- Replaces the Telegram-specific telegram_paired_users table with a
-- platform-agnostic paired_users table.

CREATE TABLE IF NOT EXISTS paired_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, platform_user_id)
);

-- Migrate existing Telegram pairing data
INSERT INTO paired_users (platform, platform_user_id, display_name, status, created_at, updated_at)
SELECT 'telegram', telegram_id::text, display_name, status, created_at, created_at
FROM telegram_paired_users
ON CONFLICT (platform, platform_user_id) DO NOTHING;
