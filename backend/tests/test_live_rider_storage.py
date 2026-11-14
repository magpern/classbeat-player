"""No rider data is written to the database, on the test database (ADR 0002, section 8: "nothing
about riders is written to the database"; ADR 0007, sections 2 and 3).

A paired app starts a live session; riders join through `POST /api/live/join` (some refused),
connect, leave, are removed and dropped after 5 minutes; the host locks, unlocks and makes new
join codes. Every row of every table, read as the superuser, is exactly as it was before the
first join, and none holds a nickname, a rider id, a rider token or its hash. The session's end
is then written as its one audit event, with no rider value in it.
"""

from __future__ import annotations

from typing import cast

from psycopg import sql

from player_backend.live.service import LiveService
from player_backend.token_policy import token_hash
from tests import pairhelp
from tests.pairhelp import bearer
from tests.sitehelp import Site

EMAIL = "rider@example.test"
JOIN = "/api/live/join"
NICKS = ("Zqxjvbn", "Wkpfrtz", "Hvmqdlc")


def _rows(site: Site) -> dict[str, list[str]]:
    """Every row of every table outside the system catalogues, as text."""
    tables = site.su.execute(
        "SELECT table_schema, table_name FROM information_schema.tables "
        "WHERE table_type = 'BASE TABLE' "
        "AND table_schema NOT IN ('pg_catalog', 'information_schema') "
        "ORDER BY 1, 2"
    ).fetchall()
    found: dict[str, list[str]] = {}
    for schema, name in tables:
        query = sql.SQL("SELECT to_jsonb(t)::text FROM {}.{} t").format(
            sql.Identifier(str(schema)), sql.Identifier(str(name))
        )
        found[f"{schema}.{name}"] = sorted(str(row[0]) for row in site.su.execute(query))
    return found


def test_no_rider_data_reaches_the_database(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    app = pairhelp.app_client(site)
    device = pairhelp.pair(site, browser, "Studio PC", app)
    started = app.post("/api/live/sessions", headers=bearer(device)).json()
    service = cast(LiveService, site.app.state.live)
    session_id = service.registry.host_session(started["hostToken"], service.clock())
    assert session_id is not None
    before = _rows(site)

    phone = site.browser("198.51.100.20")
    tokens = [
        phone.post(JOIN, json={"session": started["joinCode"], "nickname": n}).json()["riderToken"]
        for n in NICKS
    ]
    seats = [service.registry.rider_connected(t, service.clock()) for t in tokens]
    riders = [s.rider for s in seats if s is not None]
    assert len(riders) == 3
    service.registry.rider_disconnected(session_id, riders[0], service.clock())
    service.registry.drop_rider(session_id, riders[1])
    service.registry.lock(session_id, True)
    refused = phone.post(JOIN, json={"session": started["joinCode"], "nickname": "Locked"})
    assert refused.status_code == 403
    service.registry.lock(session_id, False)
    code = service.registry.new_join_code(session_id, service.clock())
    assert code is not None
    old = phone.post(JOIN, json={"session": started["joinCode"], "nickname": "Old"})
    assert old.status_code == 403
    service.sweep()

    after = _rows(site)
    assert after == before
    values = [*NICKS, *riders, *tokens, *(token_hash(t).hex() for t in tokens), code]
    stored = repr(after)
    for value in values:
        assert value not in stored

    assert service.end(session_id, "host_ended")
    events = [
        str(r[0]) for r in site.su.execute("SELECT to_jsonb(e)::text FROM player.audit_events e")
    ]
    assert any("live.session_ended" in e for e in events)
    for value in values:
        assert all(value not in e for e in events)
