"""ADR 0002, section 9, written down once for the guard tests. Never loosened to make a test pass:
a change here is a change to the ADR and is security-critical."""

from __future__ import annotations

SCHEMA = "player"

TENANT_TABLES = frozenset(
    {
        "accounts",
        "sessions",
        "passkeys",
        "passkey_registrations",
        "devices",
        "source_links",
        "classes",
        "account_sync",
        "audit_events",
    }
)

# The written allowlist of tables without the tenant policy.
CLOSED_TABLES = frozenset(
    {
        "login_links",
        "login_challenges",
        "pairings",
        "source_link_codes",
        "rate_limits",
        "signup_allowlist",
    }
)

# The migration ledger: not account data, reached by player_owner only (see the pull request).
META_TABLES = frozenset({("player_meta", "schema_migrations")})

SECURITY_DEFINER_FUNCTIONS = frozenset(
    {
        "auth_enter_session",
        "auth_enter_device",
        "auth_enter_source",
        "auth_device_active",
        "auth_session_active",
        "auth_request_login",
        "auth_complete_login",
        "auth_new_login_challenge",
        "auth_passkey_for_login",
        "auth_complete_passkey",
        "auth_start_pairing",
        "auth_find_pairing",
        "auth_decide_pairing",
        "auth_collect_pairing",
        "auth_new_link_code",
        "auth_exchange_link_code",
        "rate_limit_hit",
        "auth_purge_expired",
    }
)

FUNCTION_CONFIG = ["search_path=pg_catalog, player, pg_temp"]

# Table-level rights, then column-level rights, exactly as the catalogue must hold them.
type TableGrants = dict[str, frozenset[str]]
type ColumnGrants = dict[tuple[str, str], frozenset[str]]


def _g(*privileges: str) -> frozenset[str]:
    return frozenset(privileges)


APP_TABLE_GRANTS: TableGrants = {
    "accounts": _g("SELECT", "DELETE"),
    "sessions": _g("SELECT", "DELETE"),
    "passkeys": _g("SELECT", "INSERT", "DELETE"),
    "passkey_registrations": _g("SELECT", "INSERT", "DELETE"),
    "devices": _g("SELECT"),
    "source_links": _g("SELECT", "DELETE"),
    "classes": _g("SELECT", "INSERT", "UPDATE"),
    "account_sync": _g("SELECT", "INSERT", "UPDATE"),
    "audit_events": _g("SELECT", "INSERT"),
}
APP_COLUMN_GRANTS: ColumnGrants = {
    ("devices", "revoked_at"): _g("UPDATE"),
}

_ALL = _g("SELECT", "INSERT", "UPDATE", "DELETE")
AUTH_TABLE_GRANTS: TableGrants = {
    "login_links": _ALL,
    "login_challenges": _ALL,
    "pairings": _ALL,
    "source_link_codes": _ALL,
    "rate_limits": _ALL,
    "signup_allowlist": _g("SELECT"),
    "accounts": _g("SELECT", "INSERT"),
    "sessions": _g("SELECT", "INSERT", "DELETE"),
    "devices": _g("SELECT", "INSERT", "DELETE"),
    "source_links": _g("SELECT", "INSERT"),
    "passkeys": _g("SELECT"),
    "audit_events": _g("INSERT", "DELETE"),
}
AUTH_COLUMN_GRANTS: ColumnGrants = {
    ("sessions", "last_used_at"): _g("UPDATE"),
    ("devices", "last_used_at"): _g("UPDATE"),
    ("source_links", "last_used_at"): _g("UPDATE"),
    ("passkeys", "sign_count"): _g("UPDATE"),
    ("passkeys", "last_used_at"): _g("UPDATE"),
    # Beyond the ADR's table, for the retention purge (review note on #8; flagged in the PR).
    ("audit_events", "occurred_at"): _g("SELECT"),
}
