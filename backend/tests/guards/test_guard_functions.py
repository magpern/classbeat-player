"""Guard: the SECURITY DEFINER functions are exactly ADR 0002's list, each owned by player_auth,
with `search_path` ending in pg_temp, and not executable by PUBLIC (section 9)."""

from __future__ import annotations

from tests.dbhelp import Conn
from tests.guards.adr0002 import FUNCTION_CONFIG, SCHEMA, SECURITY_DEFINER_FUNCTIONS

_DEFINERS = (
    "SELECT n.nspname, p.proname, p.proowner::regrole::text, p.proconfig, "
    "p.proacl IS NULL, "
    "EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0), "
    "has_function_privilege('player_app', p.oid, 'EXECUTE') "
    "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
    "WHERE p.prosecdef AND "
    "n.nspname <> ALL (ARRAY['pg_catalog', 'information_schema']) "
    "AND n.nspname !~ '^pg_(toast|temp_)'"
)


def _definers(su: Conn) -> list[tuple[object, ...]]:
    return [tuple(row) for row in su.execute(_DEFINERS).fetchall()]


def test_the_security_definer_functions_equal_the_list(su: Conn) -> None:
    # A sorted list, not a set: an overload of a listed name fails too.
    found = sorted((str(r[0]), str(r[1])) for r in _definers(su))
    assert found == sorted((SCHEMA, name) for name in SECURITY_DEFINER_FUNCTIONS)


def test_each_is_owned_by_player_auth(su: Conn) -> None:
    assert [r[1] for r in _definers(su) if r[2] != "player_auth"] == []


def test_each_has_the_search_path_with_pg_temp_last(su: Conn) -> None:
    assert [r[1] for r in _definers(su) if r[3] != FUNCTION_CONFIG] == []


def test_none_is_executable_by_public(su: Conn) -> None:
    # A null ACL means the default, which lets PUBLIC execute.
    assert [r[1] for r in _definers(su) if r[4] or r[5]] == []


def test_each_is_executable_by_player_app(su: Conn) -> None:
    assert [r[1] for r in _definers(su) if r[6] is not True] == []


def test_no_function_anywhere_is_executable_by_public(su: Conn) -> None:
    rows = su.execute(
        "SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
        "WHERE (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a "
        "WHERE a.grantee = 0)) AND "
        "n.nspname <> ALL (ARRAY['pg_catalog', 'information_schema']) "
        "AND n.nspname !~ '^pg_(toast|temp_)'"
    ).fetchall()
    assert rows == []
