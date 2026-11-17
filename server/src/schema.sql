-- Maktaba's private server. One small database on the free Cloudflare plan.

-- The people allowed to use this server: the owner and up to two others.
CREATE TABLE IF NOT EXISTS members (
  key_hash TEXT PRIMARY KEY,        -- SHA-256 of the person's HSY key; the key itself is never stored
  name TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'owner' or 'member'
  daily_share INTEGER NOT NULL DEFAULT 0, -- 0: uses the shared allowance; otherwise their own daily requests
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  daily_share INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- What each AI service has been used for today.
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,                -- YYYY-MM-DD, UTC
  provider TEXT NOT NULL,
  feature TEXT NOT NULL,
  member TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider, feature, member)
);

-- Services set aside until a time (allowance used up, key refused, service down).
CREATE TABLE IF NOT EXISTS blocks (
  provider TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL
);

-- Whole-book translations, worked through a little at a time until finished.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  member TEXT NOT NULL,
  book_key TEXT NOT NULL,
  title TEXT NOT NULL,
  lang TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  glossary TEXT NOT NULL DEFAULT '[]',
  prefer TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL,              -- queued, running, waiting, done, failed, cancelled
  total INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (state, next_run_at);

CREATE TABLE IF NOT EXISTS job_items (
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,             -- order in the book
  pid TEXT NOT NULL,                -- the paragraph's id in the app
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'p',
  chapter TEXT,
  en TEXT,
  uncertain TEXT,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'todo', -- todo, done, failed
  attempts INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  PRIMARY KEY (job_id, seq)
);
CREATE INDEX IF NOT EXISTS job_items_todo ON job_items (job_id, status, seq);
CREATE INDEX IF NOT EXISTS job_items_done ON job_items (job_id, done_at);

-- Every paragraph translated once is kept, so the same text is never paid for twice.
CREATE TABLE IF NOT EXISTS cache (
  hash TEXT PRIMARY KEY,
  en TEXT NOT NULL,
  uncertain TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Server settings (provider overrides).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Sync between one person's phones. One row per item: the latest version wins, and its
-- sequence number tells phones what changed since they last asked.
CREATE TABLE IF NOT EXISTS sync_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,      -- the person's key hash: each person has their own library
  tbl TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT,                -- JSON of the item, or NULL when it was deleted
  device TEXT NOT NULL,     -- which phone sent it, so it is not sent back to the same phone
  at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_item ON sync_log (owner, tbl, key);
CREATE INDEX IF NOT EXISTS sync_since ON sync_log (owner, seq);
