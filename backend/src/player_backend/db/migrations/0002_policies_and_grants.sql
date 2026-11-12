-- ADR 0002, section 9: row-level security and the grant tables, exactly as the ADR lists them.
-- The guard tests (tests/guards/) compare the catalogue with these and fail on any difference.

-- Every table: row-level security enabled and forced, so the owner is held by it too.
ALTER TABLE player.accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.accounts              FORCE ROW LEVEL SECURITY;
ALTER TABLE player.sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.sessions              FORCE ROW LEVEL SECURITY;
ALTER TABLE player.passkeys              ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.passkeys              FORCE ROW LEVEL SECURITY;
ALTER TABLE player.passkey_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.passkey_registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE player.devices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.devices               FORCE ROW LEVEL SECURITY;
ALTER TABLE player.source_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.source_links          FORCE ROW LEVEL SECURITY;
ALTER TABLE player.classes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.classes               FORCE ROW LEVEL SECURITY;
ALTER TABLE player.account_sync          ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.account_sync          FORCE ROW LEVEL SECURITY;
ALTER TABLE player.audit_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.audit_events          FORCE ROW LEVEL SECURITY;
ALTER TABLE player.login_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.login_links           FORCE ROW LEVEL SECURITY;
ALTER TABLE player.login_challenges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.login_challenges      FORCE ROW LEVEL SECURITY;
ALTER TABLE player.pairings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.pairings              FORCE ROW LEVEL SECURITY;
ALTER TABLE player.source_link_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.source_link_codes     FORCE ROW LEVEL SECURITY;
ALTER TABLE player.rate_limits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.rate_limits           FORCE ROW LEVEL SECURITY;
ALTER TABLE player.signup_allowlist      ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.signup_allowlist      FORCE ROW LEVEL SECURITY;

-- The tenant policy. With no account set the expression is null: no row is visible or writable.
CREATE POLICY tenant ON player.accounts
  USING      (id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.sessions
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.passkeys
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.passkey_registrations
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.devices
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.source_links
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.classes
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.account_sync
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY tenant ON player.audit_events
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));

-- The one policy on a closed table: the operator's allowlist command, as player_owner.
CREATE POLICY operator ON player.signup_allowlist TO player_owner USING (true) WITH CHECK (true);

-- Schema usage: the two running roles, nothing more.
GRANT USAGE ON SCHEMA player TO player_app, player_auth;

-- player_app: the tenant tables, under the policy (ADR 0002, section 9, first grant table).
GRANT SELECT, DELETE         ON player.accounts              TO player_app;
GRANT SELECT, DELETE         ON player.sessions              TO player_app;
GRANT SELECT, INSERT, DELETE ON player.passkeys              TO player_app;
GRANT SELECT, INSERT, DELETE ON player.passkey_registrations TO player_app;
GRANT SELECT                 ON player.devices               TO player_app;
GRANT UPDATE (revoked_at)    ON player.devices               TO player_app;
GRANT SELECT, DELETE         ON player.source_links          TO player_app;
GRANT SELECT, INSERT, UPDATE ON player.classes               TO player_app;
GRANT SELECT, INSERT, UPDATE ON player.account_sync          TO player_app;
GRANT SELECT, INSERT         ON player.audit_events          TO player_app;

-- player_auth: what its functions need (ADR 0002, section 9, second grant table).
GRANT SELECT, INSERT, UPDATE, DELETE ON player.login_links       TO player_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON player.login_challenges  TO player_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON player.pairings          TO player_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON player.source_link_codes TO player_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON player.rate_limits       TO player_auth;
GRANT SELECT                         ON player.signup_allowlist  TO player_auth;
GRANT SELECT, INSERT                 ON player.accounts          TO player_auth;
GRANT SELECT, INSERT, DELETE         ON player.sessions          TO player_auth;
GRANT UPDATE (last_used_at)          ON player.sessions          TO player_auth;
GRANT SELECT, INSERT, DELETE         ON player.devices           TO player_auth;
GRANT UPDATE (last_used_at)          ON player.devices           TO player_auth;
GRANT SELECT, INSERT                 ON player.source_links      TO player_auth;
GRANT UPDATE (last_used_at)          ON player.source_links      TO player_auth;
GRANT SELECT                         ON player.passkeys          TO player_auth;
GRANT UPDATE (sign_count, last_used_at) ON player.passkeys       TO player_auth;
GRANT INSERT, DELETE                 ON player.audit_events      TO player_auth;
-- Not in ADR 0002's table (flagged in the pull request): PostgreSQL needs SELECT on a column a
-- DELETE's WHERE reads, so auth_purge_expired cannot apply the 180-day retention without it.
-- The time column only: player_auth still reads nothing else of an event.
GRANT SELECT (occurred_at)           ON player.audit_events      TO player_auth;
