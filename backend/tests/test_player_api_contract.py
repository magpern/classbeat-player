"""The player API's real answers validate against the contract's JSON Schemas
(schema/player-api/v1; issue #106): the changes page, one class with its document, the cursor
and the error bodies, from the real routes on the test database."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
from jsonschema import Draft202012Validator

from tests import pairhelp
from tests import sourcehelp as sh
from tests.pairhelp import bearer
from tests.sitehelp import Browser, Site

SCHEMA = Path(__file__).resolve().parents[2] / "schema"
EMAIL = "rider@example.test"
CHANGES = "/api/player/changes"
CLASSES = "/api/player/classes"
CURSOR = "/api/player/cursor"
NO_CLASS = "11111111-1111-4111-8111-111111111111"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validator(name: str) -> Draft202012Validator:
    schema: dict[str, Any] = _load(SCHEMA / "player-api" / "v1" / f"{name}.schema.json")
    Draft202012Validator.check_schema(schema)
    if name == "class":
        # The class schema's own file stands where the answer's `document` points at it.
        schema["properties"]["document"] = _load(
            SCHEMA / "class-format" / "v1" / "class.schema.json"
        )
    return Draft202012Validator(schema)


def _assert_valid(name: str, answer: httpx.Response, status: int) -> Any:
    assert answer.status_code == status, answer.text
    body = answer.json()
    found = _validator(name).iter_errors(body)  # pyright: ignore[reportUnknownMemberType]
    errors = [e.message for e in found]
    assert errors == [], errors
    return body


def _paired(site: Site) -> tuple[Browser, str, Browser, str]:
    """The app, its device token, the source's server and the source token."""
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL, site.browser("198.51.100.1"))
    app = pairhelp.app_client(site, "198.51.100.1")
    token = pairhelp.pair(site, browser, "Studio PC", app)
    server = sh.server(site, "192.0.2.30")
    return app, token, server, sh.link(site, browser)


def _publish(
    server: Browser, source_token: str, class_id: str, number: int, title: str | None
) -> None:
    doc = None if title is None else sh.document(title)
    answer = sh.publish(server, source_token, sh.envelope(class_id, number, doc))
    assert answer.status_code == 200, answer.text


def test_the_answers_of_the_three_routes_match_their_schemas(site: Site) -> None:
    app, token, server, source_token = _paired(site)
    headers = bearer(token)
    # Empty account: an empty page, cursor 0.
    empty = _assert_valid("changes", app.get(CHANGES, headers=headers), 200)
    assert empty == {"changes": [], "cursor": 0, "more": False}
    _assert_valid("cursor", app.get(CURSOR, headers=headers), 200)
    # A class, another class, and a removal of the first: a page with both kinds of change.
    _publish(server, source_token, "one", 1, "First")
    _publish(server, source_token, "two", 1, "Second")
    _publish(server, source_token, "one", 2, None)
    page = _assert_valid("changes", app.get(CHANGES, headers=headers), 200)
    assert [c["removed"] for c in page["changes"]] == [False, True]
    assert page["changes"][1]["content_hash"] is None
    # A page that is not the last.
    first = _assert_valid("changes", app.get(CHANGES + "?limit=1", headers=headers), 200)
    assert first["more"] is True
    assert _assert_valid("cursor", app.get(CURSOR, headers=headers), 200) == {"cursor": 3}
    kept = next(c for c in page["changes"] if not c["removed"])
    held = _assert_valid("class", app.get(f"{CLASSES}/{kept['class_id']}", headers=headers), 200)
    assert held["document"] == sh.document("Second")


def test_the_error_bodies_of_the_three_routes_match_their_schema(site: Site) -> None:
    app, token, server, source_token = _paired(site)
    headers = bearer(token)
    _publish(server, source_token, "one", 1, "First")
    for path, status, code in (
        (CHANGES + "?limit=0", 422, "invalid_request"),
        (f"{CLASSES}/not-an-id", 422, "invalid_request"),
        (f"{CLASSES}/{NO_CLASS}", 404, "not_found"),
        (CHANGES + "?after=99", 409, "resync_required"),
    ):
        body = _assert_valid("error", app.get(path, headers=headers), status)
        assert body["error"] == code
    assert _assert_valid("error", app.get(CHANGES + "?after=99", headers=headers), 409) == {
        "error": "resync_required",
        "cursor": 1,
    }
    # A token that does not work: by shape, then as the table has it.
    for route in (CHANGES, CURSOR, f"{CLASSES}/{NO_CLASS}"):
        body = _assert_valid("error", app.get(route), 401)
        assert body == {"error": "invalid_token"}
    site.su.execute(
        "UPDATE player.devices SET created_at = now() - interval '1 year', "
        "last_used_at = now() - interval '181 days'"
    )
    body = _assert_valid("error", app.get(CURSOR, headers=headers), 401)
    assert body == {"error": "token_expired"}
    site.su.execute("UPDATE player.devices SET last_used_at = now(), revoked_at = now()")
    body = _assert_valid("error", app.get(CURSOR, headers=headers), 401)
    assert body == {"error": "token_revoked"}
