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
