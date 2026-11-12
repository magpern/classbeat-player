-- ADR 0002, section 9: the schema and its tables. Runs as player_owner, which owns everything.
-- Every token, code and challenge is kept only as its SHA-256 (32 bytes, unique where looked up).

REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA player;
REVOKE ALL ON SCHEMA player FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Tenant tables: an account's data. Each has account_id (accounts uses its id) and the policy
-- `tenant` (0002_policies_and_grants.sql).
-- ---------------------------------------------------------------------------------------------

CREATE TABLE player.accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL UNIQUE
                      CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email))),
  passkey_user_handle bytea NOT NULL UNIQUE CHECK (octet_length(passkey_user_handle) = 32),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player.sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  signed_in_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  client_family text NOT NULL DEFAULT '' CHECK (length(client_family) <= 40)
);
CREATE INDEX sessions_account ON player.sessions (account_id);

CREATE TABLE player.passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE CHECK (octet_length(credential_id) BETWEEN 16 AND 1023),
  public_key    bytea NOT NULL,
  sign_count    bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports    text[] NOT NULL DEFAULT '{}',
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkeys_account ON player.passkeys (account_id);

CREATE TABLE player.passkey_registrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  session_id     uuid NOT NULL REFERENCES player.sessions (id) ON DELETE CASCADE,
  challenge_hash bytea NOT NULL UNIQUE CHECK (octet_length(challenge_hash) = 32),
  expires_at     timestamptz NOT NULL
);
CREATE INDEX passkey_registrations_account ON player.passkey_registrations (account_id);

CREATE TABLE player.devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  platform     text NOT NULL CHECK (length(platform) BETWEEN 1 AND 40),
  version      text NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX devices_account ON player.devices (account_id);

CREATE TABLE player.source_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  source_id    text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9-]{0,39}$'),
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX source_links_account ON player.source_links (account_id);

-- One row per class key for the life of the account (ADR 0002, section 7). Number 0 is the
-- placeholder that is never committed; a removal keeps the row as the marker, without a document.
CREATE TABLE player.classes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  source_id          text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9-]{0,39}$'),
  source_class_id    text NOT NULL CHECK (length(source_class_id) BETWEEN 1 AND 100),
  publication_number bigint NOT NULL CHECK (publication_number >= 0),
  kind               text CHECK (kind IN ('class', 'removal')),
  content_hash       text CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  published_at       timestamptz,
  sync_position      bigint CHECK (sync_position > 0),
  document           jsonb,
  UNIQUE (account_id, source_id, source_class_id),
  CHECK ((publication_number = 0) = (kind IS NULL)),
  CHECK (document IS NULL OR (kind = 'class' AND content_hash IS NOT NULL))
);

CREATE TABLE player.account_sync (
  account_id uuid PRIMARY KEY REFERENCES player.accounts (id) ON DELETE CASCADE,
  position   bigint NOT NULL DEFAULT 0 CHECK (position >= 0)
);

-- ADR 0002, section 11. Never a token, a code, a hash, a class title, a nickname or a reading.
CREATE TABLE player.audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  event           text NOT NULL CHECK (event ~ '^[a-z][a-z_.]{0,63}$'),
  credential_kind text CHECK (credential_kind IN ('session', 'device', 'source', 'link',
                                                  'passkey', 'pairing', 'host', 'controller')),
  credential_id   uuid,
  client_network  cidr,
  client_family   text NOT NULL DEFAULT '' CHECK (length(client_family) <= 40),
  detail          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX audit_events_account_time ON player.audit_events (account_id, occurred_at);
CREATE INDEX audit_events_time ON player.audit_events (occurred_at);

-- ---------------------------------------------------------------------------------------------
-- Closed tables: no grant and no policy for player_app; reached only through the functions.
-- This list, with signup_allowlist, is the written allowlist of tables without the tenant policy.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE player.login_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_hash    bytea NOT NULL UNIQUE CHECK (octet_length(link_hash) = 32),
  email        text NOT NULL CHECK (length(email) <= 254),
  browser_hash bytea NOT NULL CHECK (octet_length(browser_hash) = 32),
  usable       boolean NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX login_links_email_browser ON player.login_links (email, browser_hash);

CREATE TABLE player.login_challenges (
  challenge_hash bytea PRIMARY KEY CHECK (octet_length(challenge_hash) = 32),
  browser_hash   bytea NOT NULL CHECK (octet_length(browser_hash) = 32),
  expires_at     timestamptz NOT NULL
);

-- account_id stays null until approval.
CREATE TABLE player.pairings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash bytea NOT NULL UNIQUE CHECK (octet_length(device_code_hash) = 32),
  user_code_hash   bytea NOT NULL UNIQUE CHECK (octet_length(user_code_hash) = 32),
  platform         text NOT NULL CHECK (length(platform) BETWEEN 1 AND 40),
  version          text NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  state            text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'denied')),
  account_id       uuid REFERENCES player.accounts (id) ON DELETE CASCADE,
  device_name      text CHECK (length(device_name) BETWEEN 1 AND 40),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_polled_at   timestamptz,
  expires_at       timestamptz NOT NULL,
  CHECK (state <> 'pending' OR account_id IS NULL),
  CHECK (state <> 'approved' OR account_id IS NOT NULL)
);

CREATE TABLE player.source_link_codes (
  code_hash      bytea PRIMARY KEY CHECK (octet_length(code_hash) = 32),
  account_id     uuid NOT NULL REFERENCES player.accounts (id) ON DELETE CASCADE,
  source_id      text NOT NULL,
  redirect_uri   text NOT NULL CHECK (length(redirect_uri) <= 2000),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at     timestamptz NOT NULL
);

-- Keys are hashes: an email or an address is never stored in a counter.
CREATE TABLE player.rate_limits (
  key_hash     bytea NOT NULL CHECK (octet_length(key_hash) = 32),
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL CHECK (hits >= 0),
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (key_hash, window_start)
);

-- Kept by the operator's `allowlist` command, which connects as player_owner.
CREATE TABLE player.signup_allowlist (
  email    text PRIMARY KEY CHECK (length(email) <= 254 AND email = lower(btrim(email))),
  added_at timestamptz NOT NULL DEFAULT now()
);
