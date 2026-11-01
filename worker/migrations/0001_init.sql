CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sending','complete')),
  created_at INTEGER NOT NULL,
  drawn_at INTEGER,
  completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_event_title ON events(title);
CREATE TABLE IF NOT EXISTS participants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  email TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  code_hash TEXT,
  challenge_token TEXT,
  code_expires_at INTEGER,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  last_code_sent_at INTEGER,
  verified_at INTEGER,
  PRIMARY KEY(event_id,name),
  UNIQUE(event_id,name_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_email ON participants(event_id,email) WHERE verified=1 AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_participants_ready ON participants(event_id,verified);
CREATE TABLE IF NOT EXISTS outbox (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  giver TEXT NOT NULL,
  encrypted_recipient TEXT,
  nonce TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  PRIMARY KEY(event_id,giver),
  FOREIGN KEY(event_id,giver) REFERENCES participants(event_id,name)
);
CREATE INDEX IF NOT EXISTS idx_outbox_unsent ON outbox(state,lease_until);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
