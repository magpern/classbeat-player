"""`GET /api/site/passkeys` (ADR 0002, sections 4 and 11; ADR 0010, section 7;
schema/site-api/v1/passkeys.schema.json): the account's own passkeys and `can_add`.

`can_add` is the rule both steps of a registration refuse with, so the two agree for every
account kind, before and after a kind changes. Every answer is checked against the schema on
disk. More than 10 rows, a data fault, is a 500 that shows nothing of them. Isolation between
two accounts is in tests/guards/test_guard_endpoint_isolation.py. No network.
"""

from __future__ import annotations

import json
import logging
import secrets
import sys
import uuid
from pathlib import Path

import pydantic
import pytest
from jsonschema import Draft202012Validator

from player_backend.own_sign_in_policy import ACCOUNT_KINDS, own_sign_in_open
from player_backend.passkey_list_policy import PasskeysOverCap
from player_backend.site.answers import GENERATED_DIR, NAMESPACE, passkeys_answer
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from tests.passkeyhelp import OPTIONS, PASSKEYS, Authenticator, options_of, register
from tests.sitehelp import ISSUER, SESSION_COOKIE, Browser, Site

EMAIL = "ann@example.test"
CLOSED_ANSWER = {"error": "passkeys_closed"}
KEY = f"{NAMESPACE}.site_api_passkeys"
SCHEMA = Path(__file__).resolve().parents[2] / "schema" / "site-api" / "v1" / "passkeys.schema.json"
CONTRACT = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))


def _valid(answer: object) -> None:
    errors = list(CONTRACT.iter_errors(answer))  # pyright: ignore[reportUnknownMemberType, reportArgumentType]
    assert errors == []


def _listed(browser: Browser) -> dict[str, object]:
    answer = browser.get(PASSKEYS)
    assert answer.status_code == 200, answer.text
    assert answer.headers["content-type"] == "application/json"
    assert answer.headers["cache-control"] == "no-store"
    body = answer.json()
    _valid(body)
    assert isinstance(body, dict)
    return body  # pyright: ignore[reportUnknownVariableType]


def _set_kind(site: Site, account: uuid.UUID, kind: str) -> None:
    """An instructor has its classbeat identity; the other kinds have none."""
    identity = (ISSUER, "subject-" + str(account)) if kind == "instructor" else (None, None)
    site.su.execute(
        "UPDATE player.accounts SET kind = %s, classbeat_issuer = %s, classbeat_subject = %s "
        "WHERE id = %s",
        (kind, *identity, account),
    )


def _follower_session(site: Site, email: str = EMAIL) -> tuple[Browser, uuid.UUID]:
    """A browser with a fresh session of a follower, made by the tests' superuser."""
    row = site.su.execute(
        "INSERT INTO player.accounts (kind, email, passkey_user_handle) "
        "VALUES ('follower', %s, %s) RETURNING id",
        (email, secrets.token_bytes(32)),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    token = new_token("ses")
    site.su.execute(
        "INSERT INTO player.sessions (account_id, token_hash) VALUES (%s, %s)",
        (row[0], token_hash(token)),
    )
    browser = site.browser()
    browser.cookies.set(SESSION_COOKIE, token, domain="player.test")
    return browser, row[0]


def _stored_passkeys(site: Site, account: uuid.UUID, count: int) -> None:
    """`count` passkeys written by the superuser, past the cap the backend holds."""
    for n in range(count):
        site.su.execute(
            "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
            "VALUES (%s, %s, %s, %s)",
            (account, secrets.token_bytes(32), b"key", f"Stored {n}"),
        )


def test_an_instructor_is_told_it_may_not_add_one(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    assert _listed(browser) == {"passkeys": [], "can_add": False}
    refused = browser.post(OPTIONS)
    assert refused.status_code == 403 and refused.json() == CLOSED_ANSWER


def test_a_follower_is_told_it_may_add_one_and_sees_its_passkeys(site: Site) -> None:
    site.follower(EMAIL)
    browser = site.link_sign_in(EMAIL)
    assert _listed(browser) == {"passkeys": [], "can_add": True}
    assert register(browser, Authenticator(), "First").status_code == 201
    assert register(browser, Authenticator("EdDSA"), "Second").status_code == 201
    body = _listed(browser)
    assert body["can_add"] is True
    listed = body["passkeys"]
    assert isinstance(listed, list)
    assert [p["name"] for p in listed] == ["First", "Second"]  # pyright: ignore[reportUnknownVariableType]
    assert all(set(p) == {"id", "name", "created_at", "last_used_at"} for p in listed)  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]


@pytest.mark.parametrize("kind", sorted(ACCOUNT_KINDS))
def test_can_add_and_the_registration_refusal_agree_for_every_kind(site: Site, kind: str) -> None:
    # The challenge is taken while the account is a follower, then its kind changes: both
    # steps of a registration and the list are asked of the same account of `kind`.
    browser, account = _follower_session(site)
    authenticator = Authenticator()
    options = options_of(browser.post(OPTIONS))
    _set_kind(site, account, kind)
    body = _listed(browser)
    can_add = body["can_add"]
    assert can_add is own_sign_in_open(kind)
    finished = browser.post(
        PASSKEYS, json={"name": "Key", "credential": authenticator.create(options)}
    )
    started = browser.post(OPTIONS)
    if can_add:
        assert finished.status_code == 201, finished.text
        assert started.status_code == 200, started.text
    else:
        assert finished.status_code == 403 and finished.json() == CLOSED_ANSWER
        assert started.status_code == 403 and started.json() == CLOSED_ANSWER
    # And back: the same account as a follower again may add, and is told so.
    _set_kind(site, account, "follower")
    assert _listed(browser)["can_add"] is True
    assert browser.post(OPTIONS).status_code == 200


def test_passkeys_made_before_a_kind_closed_stay_listed_with_can_add_false(site: Site) -> None:
    browser, account = _follower_session(site)
    assert register(browser, Authenticator(), "Kept").status_code == 201
    _set_kind(site, account, "unlinked")
    body = _listed(browser)
    assert body["can_add"] is False
    listed = body["passkeys"]
    assert isinstance(listed, list) and [p["name"] for p in listed] == ["Kept"]  # pyright: ignore[reportUnknownVariableType]


def test_ten_passkeys_are_listed(site: Site) -> None:
    browser, account = _follower_session(site)
    _stored_passkeys(site, account, 10)
    body = _listed(browser)
    listed = body["passkeys"]
    assert isinstance(listed, list) and len(listed) == 10  # pyright: ignore[reportUnknownArgumentType]
    assert body["can_add"] is True  # the kind's rule; the cap is still refused when adding
    refused = browser.post(OPTIONS)
    assert refused.status_code == 409 and refused.json() == {"error": "too_many_passkeys"}


@pytest.mark.parametrize("count", [11, 12])
def test_more_than_ten_rows_is_a_500_that_shows_none_of_them(
    site: Site, count: int, caplog: pytest.LogCaptureFixture
) -> None:
    browser, account = _follower_session(site)
    _stored_passkeys(site, account, count)
    careless = site.browser(raise_errors=False)
    careless.take_cookies(browser)
    with caplog.at_level(logging.ERROR, logger="player_backend.app"):
        answer = careless.get(PASSKEYS)
    assert answer.status_code == 500 and answer.json() == {"error": "internal_error"}
    assert answer.headers["cache-control"] == "no-store"
    assert "Stored" not in answer.text and "can_add" not in answer.text
    # Refused by the deliberate check of the cap, not by whatever else happens to fail.
    faults = [r.exc_info[0] for r in caplog.records if r.exc_info is not None]
    assert faults == [PasskeysOverCap]
    # Another account is not affected.
    other, _ = _follower_session(site, "other@example.test")
    assert _listed(other) == {"passkeys": [], "can_add": True}


def test_the_model_is_the_contracts_generated_one() -> None:
    model = passkeys_answer()
    assert Path(GENERATED_DIR, "site_api_passkeys.py").is_file()
    assert model.__name__ == "PasskeysAnswer" and model.__module__ == KEY
    assert sys.modules[KEY].__file__ == str(GENERATED_DIR / "site_api_passkeys.py")
    assert model(passkeys=[], can_add=False).model_dump(mode="json") == {
        "passkeys": [],
        "can_add": False,
    }
    with pytest.raises(pydantic.ValidationError):
        model.model_validate({"passkeys": []})  # `can_add` is required
    with pytest.raises(pydantic.ValidationError):
        model.model_validate({"passkeys": [], "can_add": 1})  # a boolean, strictly
    with pytest.raises(pydantic.ValidationError):
        model.model_validate({"passkeys": [], "can_add": True, "count": 0})
    # Loaded once per process.
    assert passkeys_answer() is model
