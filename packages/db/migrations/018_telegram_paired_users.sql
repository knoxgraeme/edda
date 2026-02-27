-- Telegram user pairing for bot access control.
-- Unknown users create a pending row; owner approves/rejects via inbox.

CREATE TABLE telegram_paired_users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_id      BIGINT NOT NULL UNIQUE,
  display_name     TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
