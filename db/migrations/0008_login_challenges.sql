-- =============================================================================
-- 0008: login challenges (the second factor of a two-phase sign-in)
--
-- When an account has TOTP enabled, a correct password is necessary but not
-- sufficient. The two phases have to be tied together by something, and that
-- something must not be "the password was correct, trust the next request" —
-- otherwise the second factor is optional, which defeats it.
--
-- A short-lived, single-use challenge is that tie. Properties that matter:
--
--   * Single use. `consumed_at` is set when the challenge is redeemed, and the
--     UPDATE ... WHERE consumed_at IS NULL is the guard. Without it, a TOTP code
--     could be replayed against the same challenge for its whole window.
--
--   * Short. Five minutes, which is long enough to open an authenticator app
--     and short enough that a stray challenge in a browser history is inert.
--
--   * Hashed. Same reasoning as sessions.token_hash: the row is evidence, not a
--     credential, so a database read cannot complete a login.
--
--   * Bounded. `attempts` caps how many codes can be tried against ONE
--     challenge. Without it, an attacker who already has the password could sit
--     on a single challenge and brute-force the 6-digit space, and the
--     per-account throttle in 0002 would not see it because it counts password
--     failures, not code failures.
--
-- Expired and consumed rows are deleted opportunistically rather than by TTL.
-- =============================================================================


CREATE TABLE login_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- sha256 of the token handed to the client; never the token itself
  token_hash  text NOT NULL UNIQUE,

  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  user_agent  text,
  ip          inet
);

CREATE INDEX login_challenges_user_idx ON login_challenges (user_id, created_at DESC);
CREATE INDEX login_challenges_expiry_idx ON login_challenges (expires_at);


-- =============================================================================
-- Media: which revision/entry referenced an upload.
--
-- `media` (0001) records what was uploaded. This records what it was used by,
-- so /studio can answer "is this file still referenced" without scanning every
-- post body for the URL — which is the only other way to know, and which gets
-- slower and more approximate as the corpus grows.
--
-- Deliberately not a foreign key to post_revisions: a revision is immutable, so
-- a reference from revision 3 stays true after revision 4 is published, and the
-- file must stay alive even when nothing CURRENT points at it. This table is
-- therefore advisory — the garbage collector in `scripts/db/check-orphan-media`
-- uses it to build a deletion CANDIDATE list, never to delete on its own.
-- =============================================================================

ALTER TABLE media
  ADD COLUMN IF NOT EXISTS sha256 text;

COMMENT ON COLUMN media.sha256 IS
  'Content hash, for deduplicating an upload of a file already in the store.';
