"""Guard: with two accounts, every endpoint is called as one and can neither read nor change
the other's rows (ADR 0002, section 9, the last guard of its list).

Every route that enters an account, by a site session, a device token or a source token, must
have a case below: a new one fails until it has.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import LiteralString

from player_backend.player_api.deps import device_token
from player_backend.site.deps import site_session
from player_backend.source_api.deps import source_token
from tests import pairhelp
from tests import sourcehelp as sh
from tests.pairhelp import DECIDE, DEVICE, DEVICES, FIND, bearer
from tests.routehelp import routes_of
from tests.sitehelp import Browser, Site

A = "a@example.test"
B = "b@example.test"
SESSIONS = "/api/site/sessions"
CHANGES = "/api/player/changes"
PLAYER_CLASSES = "/api/player/classes"
CURSOR = "/api/player/cursor"


@dataclass(frozen=True)
class Other:
    """What account B owns, as far as account A could ever name it."""

    session_id: str
    device_id: str
    token: str  # B's device token: B's to hold, used here only to see that it still works
    user_code: str  # of a pairing B has approved and whose token is not collected yet
    link_id: str
    source_token: str  # B's source token: used here only to see that it still works
    class_ids: tuple[str, ...]  # the ids of B's class rows, as the player API names a class
    cursor: int  # B's sync cursor


@dataclass(frozen=True)
class Actor:
    """Account A: a signed-in browser, and its app with a device token."""

    browser: Browser
    app: Browser
    token: str
    source_token: str
    server: Browser
    other: Other


def _snapshot(site: Site, email: str) -> list[tuple[object, ...]]:
    """Everything the account owns that these endpoints could touch."""
    found: list[tuple[object, ...]] = []
    for statement in (
        "SELECT 'session', s.id::text, s.token_hash::text FROM player.sessions s "
        "JOIN player.accounts a ON a.id = s.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'event', e.id::text, e.event FROM player.audit_events e "
        "JOIN player.accounts a ON a.id = e.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'device', d::text, '' FROM player.devices d "
        "JOIN player.accounts a ON a.id = d.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'pairing', p.id::text, p.state || ':' || p.device_name FROM player.pairings p "
        "JOIN player.accounts a ON a.id = p.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'link', l::text, '' FROM player.source_links l "
        "JOIN player.accounts a ON a.id = l.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'class', c::text, '' FROM player.classes c "
        "JOIN player.accounts a ON a.id = c.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'sync', y::text, '' FROM player.account_sync y "
        "JOIN player.accounts a ON a.id = y.account_id WHERE a.email = %s ORDER BY 2",
    ):
        found.extend(site.su.execute(statement, (email,)).fetchall())
    return found


def _one(site: Site, statement: LiteralString, email: str) -> str:
    row = site.su.execute(statement, (email,)).fetchone()
    assert row is not None
    return str(row[0])


def _list(site: Site, a: Actor) -> None:
    listed = a.browser.get(SESSIONS).json()["sessions"]
    assert len(listed) == 1 and listed[0]["current"] is True
    assert a.other.session_id not in str(listed)


def _end_one(site: Site, a: Actor) -> None:
    # B's session id is known to A here; it is still not A's to end.
    assert a.browser.delete(f"{SESSIONS}/{a.other.session_id}").status_code == 404


def _sign_out(site: Site, a: Actor) -> None:
    assert a.browser.post("/api/site/sign-out").status_code == 204


def _end_all(site: Site, a: Actor) -> None:
    assert a.browser.post(f"{SESSIONS}/end-all").status_code == 204


def _find_pairing(site: Site, a: Actor) -> None:
    # The code of a pairing B approved is known to A here; it shows A nothing.
    found = a.browser.post(FIND, json={"code": a.other.user_code})
    assert found.status_code == 404


def _decide_pairing(site: Site, a: Actor) -> None:
    for approve in (False, True):
        body = {"code": a.other.user_code, "approve": approve, "name": "Taken"}
        assert a.browser.post(DECIDE, json=body).status_code == 404


def _list_devices(site: Site, a: Actor) -> None:
    listed = a.browser.get(DEVICES).json()["devices"]
    assert [device["name"] for device in listed] == ["A PC"]
    assert a.other.device_id not in str(listed)


def _revoke_device(site: Site, a: Actor) -> None:
    # B's device id is known to A here; it is still not A's to revoke.
    assert a.browser.delete(f"{DEVICES}/{a.other.device_id}").status_code == 404


def _check_source(site: Site, a: Actor) -> None:
    body = {"source": "classbeat", "redirect_uri": sh.REDIRECT}
    assert a.browser.post(sh.CHECK, json=body).json()["source"] == "classbeat"


def _approve_link(site: Site, a: Actor) -> None:
    # The code is A's: B's rows do not change.
    _, challenge = sh.pkce()
    assert sh.approve(a.browser, challenge).status_code == 200


def _list_links(site: Site, a: Actor) -> None:
    listed = a.browser.get(sh.LINKS).json()["source_links"]
    assert len(listed) == 1 and a.other.link_id not in str(listed)


def _revoke_link(site: Site, a: Actor) -> None:
    # B's link id is known to A here; it is still not A's to revoke.
    assert a.browser.delete(f"{sh.LINKS}/{a.other.link_id}").status_code == 404


def _publish(site: Site, a: Actor) -> None:
    # The same class id as B's: it is A's own class, and B's stays as it was.
    answer = sh.publish(a.server, a.source_token, sh.envelope("shared", 1, sh.document("A")))
    assert answer.status_code == 200 and answer.json()["status"] == "applied"
    removal = sh.publish(a.server, a.source_token, sh.envelope("b-only", 9, None))
    assert removal.status_code == 200


def _read_numbers(site: Site, a: Actor) -> None:
    read = a.server.get(f"{sh.CLASSES}/shared", headers=sh.bearer(a.source_token))
    assert read.json()["highest_publication_number"] == 1
    other = a.server.get(f"{sh.CLASSES}/b-kept", headers=sh.bearer(a.source_token))
    assert other.status_code == 404


def _end_own_link(site: Site, a: Actor) -> None:
    assert a.server.delete(sh.OWN_LINK, headers=sh.bearer(a.source_token)).status_code == 204


def _own_device(site: Site, a: Actor) -> None:
    answer = a.app.get(DEVICE, headers=bearer(a.token))
    assert answer.status_code == 200 and answer.json()["device"]["name"] == "A PC"
    assert "B PC" not in answer.text


def _changes(site: Site, a: Actor) -> None:
    # Only A's own changes, in A's own order: B's class of the same source class id is not one.
    answer = a.app.get(CHANGES, headers=bearer(a.token))
    assert answer.status_code == 200
    body = answer.json()
    listed = [
        (c["source_class_id"], c["publication_number"], c["removed"]) for c in body["changes"]
    ]
    assert listed == [("shared", 1, False), ("b-only", 9, True)]
    assert (body["cursor"], body["more"]) == (2, False)
    # B's cursor is above A's: it was never A's, and it shows A nothing of B.
    ahead = a.app.get(f"{CHANGES}?after={a.other.cursor}", headers=bearer(a.token))
    assert ahead.status_code == 409 and ahead.json() == {"error": "resync_required", "cursor": 2}
    # A cursor that A's own order has reached reads A's rows after it, and nothing of B's.
    later = a.app.get(f"{CHANGES}?after=1", headers=bearer(a.token))
    assert [c["source_class_id"] for c in later.json()["changes"]] == ["b-only"]
    for class_id in a.other.class_ids:
        assert class_id not in answer.text + ahead.text + later.text


def _held_class(site: Site, a: Actor) -> None:
    # B's class ids are known to A here; they are still not A's to read.
    for class_id in a.other.class_ids:
        refused = a.app.get(f"{PLAYER_CLASSES}/{class_id}", headers=bearer(a.token))
        assert refused.status_code == 404 and refused.json() == {"error": "not_found"}
    listed = a.app.get(CHANGES, headers=bearer(a.token)).json()["changes"]
    own = next(c["class_id"] for c in listed if c["source_class_id"] == "shared")
    answer = a.app.get(f"{PLAYER_CLASSES}/{own}", headers=bearer(a.token))
    assert answer.status_code == 200 and answer.json()["document"]["class"]["title"] == "A"


def _cursor(site: Site, a: Actor) -> None:
    answer = a.app.get(CURSOR, headers=bearer(a.token))
    assert answer.status_code == 200 and answer.json() == {"cursor": 2}


def _revoke_own_device(site: Site, a: Actor) -> None:
    assert a.app.delete(DEVICE, headers=bearer(a.token)).status_code == 204
    assert a.app.get(DEVICE, headers=bearer(a.token)).status_code == 401


# In this order: the last two end A's device and A's sessions.
CASES: dict[tuple[str, str], Callable[[Site, Actor], None]] = {
    ("GET", "/api/site/sessions"): _list,
    ("DELETE", "/api/site/sessions/{session_id}"): _end_one,
    ("POST", "/api/site/sign-out"): _sign_out,
    ("POST", "/api/site/pairing/find"): _find_pairing,
    ("POST", "/api/site/pairing/decide"): _decide_pairing,
    ("GET", "/api/site/devices"): _list_devices,
    ("DELETE", "/api/site/devices/{device_id}"): _revoke_device,
    ("POST", "/api/site/source-links/check"): _check_source,
    ("POST", "/api/site/source-links/approve"): _approve_link,
    ("GET", "/api/site/source-links"): _list_links,
    ("DELETE", "/api/site/source-links/{link_id}"): _revoke_link,
    ("POST", "/api/source/publications"): _publish,
    ("GET", "/api/source/classes/{source_class_id}"): _read_numbers,
    ("DELETE", "/api/source/link"): _end_own_link,
    ("GET", "/api/player/device"): _own_device,
    ("GET", "/api/player/changes"): _changes,
    ("GET", "/api/player/classes/{class_id}"): _held_class,
    ("GET", "/api/player/cursor"): _cursor,
    ("DELETE", "/api/player/device"): _revoke_own_device,
    ("POST", "/api/site/sessions/end-all"): _end_all,
}


def test_every_endpoint_that_enters_an_account_has_a_case(site: Site) -> None:
    entering = {
        (r.method, r.path)
        for r in routes_of(site.app)
        if site_session in r.dependencies
        or device_token in r.dependencies
        or source_token in r.dependencies
    }
    assert entering == set(CASES)


def _account_b(site: Site) -> tuple[Browser, Other]:
    b = site.sign_in(B, site.browser("198.51.100.2"))
    app = pairhelp.app_client(site, "198.51.100.2")
    token = pairhelp.pair(site, b, "B PC", app)
    # Used once, so that "last used" is already written when the rows are compared.
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200
    waiting = pairhelp.start(site, app)
    assert pairhelp.approve(b, waiting, "B waiting").status_code == 200
    b_source = sh.link(site, b)
    server = sh.server(site, "192.0.2.20")
    for class_id, number in (("shared", 3), ("b-only", 4), ("b-kept", 2)):
        published = sh.publish(server, b_source, sh.envelope(class_id, number, sh.document("B")))
        assert published.status_code == 200
    other = Other(
        session_id=_one(
            site,
            "SELECT x.id::text FROM player.sessions x "
            "JOIN player.accounts a ON a.id = x.account_id WHERE a.email = %s",
            B,
        ),
        device_id=_one(
            site,
            "SELECT x.id::text FROM player.devices x "
            "JOIN player.accounts a ON a.id = x.account_id WHERE a.email = %s",
            B,
        ),
        token=token,
        user_code=waiting.user_code,
        link_id=_one(
            site,
            "SELECT x.id::text FROM player.source_links x "
            "JOIN player.accounts a ON a.id = x.account_id WHERE a.email = %s",
            B,
        ),
        source_token=b_source,
        class_ids=tuple(
            str(row[0])
            for row in site.su.execute(
                "SELECT x.id FROM player.classes x "
                "JOIN player.accounts a ON a.id = x.account_id WHERE a.email = %s "
                "ORDER BY x.sync_position",
                (B,),
            ).fetchall()
        ),
        cursor=int(
            _one(
                site,
                "SELECT x.position FROM player.account_sync x "
                "JOIN player.accounts a ON a.id = x.account_id WHERE a.email = %s",
                B,
            )
        ),
    )
    return b, other


def test_as_one_account_no_endpoint_reads_or_changes_the_others_rows(site: Site) -> None:
    site.allow(A)
    site.allow(B)
    b, other = _account_b(site)
    b_app = pairhelp.app_client(site, "198.51.100.2")
    a_app = pairhelp.app_client(site, "198.51.100.1")
    first = site.sign_in(A, site.browser("198.51.100.1"))
    a_token = pairhelp.pair(site, first, "A PC", a_app)
    a_source = sh.link(site, first)
    a_server = sh.server(site, "192.0.2.21")
    assert first.post("/api/site/sign-out").status_code == 204
    for case in CASES.values():
        site.su.execute("DELETE FROM player.rate_limits")
        a = Actor(
            site.sign_in(A, site.browser("198.51.100.1")),
            a_app,
            a_token,
            a_source,
            a_server,
            other,
        )
        before = _snapshot(site, B)
        # A session, a device, a pairing that waits, a source link with three classes and its
        # sync cursor, and the events of making them.
        kinds = ["session", *["event"] * 8, "device", "pairing", "link", *["class"] * 3, "sync"]
        assert [row[0] for row in before] == kinds
        case(site, a)
        assert _snapshot(site, B) == before
        assert b.get(SESSIONS).status_code == 200
        assert b_app.get(DEVICE, headers=bearer(other.token)).status_code == 200
        b_read = sh.server(site, "192.0.2.20").get(
            f"{sh.CLASSES}/shared", headers=sh.bearer(other.source_token)
        )
        assert b_read.json()["highest_publication_number"] == 3
        b_sync = b_app.get(CHANGES, headers=bearer(other.token)).json()
        assert [c["class_id"] for c in b_sync["changes"]] == list(other.class_ids)
        assert b_sync["cursor"] == other.cursor
    # And the cases did act on A's own rows: A's classes are A's, A's source ended its own link,
    # and the last two revoked A's device and ended every session of A.
    assert sorted(row[:3] for row in sh.class_rows(site, A)) == [
        ("b-only", 9, "removal"),
        ("shared", 1, "class"),
    ]
    assert site.su.execute(
        "SELECT count(*) FROM player.source_links l JOIN player.accounts a "
        "ON a.id = l.account_id WHERE a.email = %s",
        (A,),
    ).fetchone() == (0,)
    assert pairhelp.device_rows(site, A) == [("A PC", True, True)]
    assert site.su.execute(
        "SELECT count(*) FROM player.sessions s JOIN player.accounts a ON a.id = s.account_id "
        "WHERE a.email = %s",
        (A,),
    ).fetchone() == (0,)
