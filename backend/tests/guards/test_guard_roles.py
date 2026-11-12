"""Guard: the roles of ADR 0002, section 9, and the log settings of section 11."""

from __future__ import annotations

from tests.dbhelp import Conn


def _role(su: Conn, name: str) -> dict[str, object]:
    cur = su.execute(
        "SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication "
        "FROM pg_roles WHERE rolname = %s",
        (name,),
    )
    row = cur.fetchone()
    assert row is not None, name
    assert cur.description is not None
    return {col.name: value for col, value in zip(cur.description, row, strict=True)}


def test_bypassrls_roles_are_player_auth_and_the_bootstrap_superuser(su: Conn) -> None:
    # A superuser bypasses row-level security as well, so both attributes count.
    rows = su.execute(
        "SELECT rolname FROM pg_roles WHERE rolbypassrls OR rolsuper ORDER BY rolname"
    ).fetchall()
    bootstrap = su.execute("SELECT rolname FROM pg_roles WHERE oid = 10").fetchone()
    assert bootstrap is not None
    assert {str(r[0]) for r in rows} == {"player_auth", str(bootstrap[0])}


def test_player_auth_cannot_log_in_and_its_only_member_is_player_owner(su: Conn) -> None:
    auth = _role(su, "player_auth")
    assert auth["rolcanlogin"] is False
    assert auth["rolsuper"] is False
    members = su.execute(
        "SELECT member::regrole::text FROM pg_auth_members WHERE roleid = 'player_auth'::regrole"
    ).fetchall()
    assert members == [("player_owner",)]
    memberships = su.execute(
        "SELECT roleid::regrole::text FROM pg_auth_members WHERE member = 'player_auth'::regrole"
    ).fetchall()
    assert memberships == []


def test_player_app_is_not_superuser_cannot_bypass_rls_and_logs_in(su: Conn) -> None:
    assert _role(su, "player_app") == {
        "rolsuper": False,
        "rolbypassrls": False,
        "rolcanlogin": True,
        "rolcreaterole": False,
        "rolcreatedb": False,
        "rolreplication": False,
    }


def test_player_owner_cannot_bypass_rls(su: Conn) -> None:
    owner = _role(su, "player_owner")
    assert owner["rolsuper"] is False
    assert owner["rolbypassrls"] is False


def test_player_app_owns_nothing(su: Conn) -> None:
    # pg_shdepend records ownership of every object in every database of the cluster.
    rows = su.execute(
        "SELECT classid::regclass::text, objid FROM pg_shdepend "
        "WHERE refclassid = 'pg_authid'::regclass AND refobjid = 'player_app'::regrole "
        "AND deptype = 'o'"
    ).fetchall()
    assert rows == []


def test_player_app_log_settings(su: Conn) -> None:
    row = su.execute(
        "SELECT setconfig FROM pg_db_role_setting "
        "WHERE setrole = 'player_app'::regrole AND setdatabase = 0"
    ).fetchone()
    assert row is not None
    assert sorted(str(s) for s in row[0]) == sorted(  # type: ignore[union-attr]
        [
            "log_statement=none",
            "log_min_duration_statement=-1",
            "log_parameter_max_length=0",
            "log_parameter_max_length_on_error=0",
        ]
    )
