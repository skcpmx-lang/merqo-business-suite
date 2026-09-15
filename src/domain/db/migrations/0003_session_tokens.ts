/**
 * Migration 0003 — persistent session tokens + idempotency keys.
 *
 *  - sessions.token_hash: SHA-256 of the bearer token, so a valid login
 *    survives an app restart (the raw token is never stored).
 *  - idempotency_keys: double-submission protection for write operations.
 *    A (business, session, key) triple maps to the serialized result of the
 *    first execution; repeating the key replays that result, a key reuse with
 *    a different payload is rejected.
 */
const sql = `
ALTER TABLE sessions ADD COLUMN token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, session_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_lookup
  ON idempotency_keys(business_id, session_id, idem_key);
`;

export { sql as m0003_session_tokens };
