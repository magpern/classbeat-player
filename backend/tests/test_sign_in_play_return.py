"""The `play` return entry through the site's API (ADR 0008, section 3; ADR 0006, decisions 1-3):
what is accepted, the order of the answers, the mailed link, and that the class id is kept
nowhere, logs included."""

from __future__ import annotations

import json
import logging
import uuid

import pytest
from psycopg import sql

from player_backend.db import login
from player_backend.logging_setup import configure_logging
from tests.sitehelp import ORIGIN, Site
from tests.test_play_return_entry_policy import CLASS_ID, PLAY_INVALID
from tests.test_sign_in_return import _every_value  # pyright: ignore[reportPrivateUsage]

EMAIL = "rider@example.test"
LINK = "/api/site/sign-in/link"
INVALID_EMAIL = {"error": "invalid_email"}
INVALID_RETURN = {"error": "invalid_return"}


def _mailed_fragment(site: Site) -> str:
    (mail,) = site.mailer.sent
    (link,) = [word for word in mail.body.split() if word.startswith(ORIGIN)]
    address, _, fragment = link.partition("#")
    assert address == ORIGIN + "/sign-in" and "?" not in link
    return fragment


def _count(site: Site, table: str) -> object:
    query = sql.SQL("SELECT count(*) FROM player.{}").format(sql.Identifier(table))
    row = site.su.execute(query).fetchone()
    assert row is not None
    return row[0]


@pytest.mark.parametrize("value", ["play", "play." + CLASS_ID, f"play.{uuid.uuid4()}"])
def test_the_play_entry_follows_the_token_in_the_mailed_link(site: Site, value: str) -> None:
    site.allow(EMAIL)
    asked = site.first.post(LINK, json={"email": EMAIL, "return_to": value})
    assert asked.status_code == 200 and asked.json() == {"status": "accepted"}
    fragment = _mailed_fragment(site)
    assert fragment.endswith("&return=" + value)
    token, sep, rest = fragment.partition("&return=")
    assert sep and rest == value
    # The link still signs in, with the token alone.
    done = site.first.post("/api/site/sign-in/complete", json={"token": token})
    assert done.status_code == 200


@pytest.mark.parametrize("value", PLAY_INVALID)
def test_a_wrong_play_entry_is_invalid_return(
    site: Site, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    site.allow(EMAIL)
    calls: list[object] = []
    real = login.request_link

    def recording(*args: object, **kwargs: object) -> object:
        calls.append(kwargs["email"])
        return real(*args, **kwargs)  # pyright: ignore[reportArgumentType]

    monkeypatch.setattr(login, "request_link", recording)
    refused = site.first.post(LINK, json={"email": EMAIL, "return_to": value})
    assert refused.status_code == 422 and refused.json() == INVALID_RETURN
    assert value not in refused.text and CLASS_ID not in refused.text
    # The data access was given no email, so it stopped before the sign-in call.
    assert calls == [None]
    assert site.mailer.sent == [] and _count(site, "login_links") == 0


def test_a_bad_email_is_answered_before_a_play_entry(site: Site) -> None:
    for email in ("not an address", "a@"):
        for value in ("Play", "play.", "play." + CLASS_ID.upper(), "play", "play." + CLASS_ID):
            refused = site.browser().post(LINK, json={"email": email, "return_to": value})
            assert refused.status_code == 422 and refused.json() == INVALID_EMAIL
    assert site.mailer.sent == [] and _count(site, "login_links") == 0


def test_the_address_limit_is_answered_before_a_wrong_play_entry(site: Site) -> None:
    site.allow(EMAIL)
    here = site.browser()
    for _ in range(10):
        bad = {"email": EMAIL, "return_to": "play." + CLASS_ID.upper()}
        assert here.post(LINK, json=bad).status_code == 422
    for value in ("Play", "play." + CLASS_ID[:-1], "play", "play." + CLASS_ID):
        limited = here.post(LINK, json={"email": EMAIL, "return_to": value})
        assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert site.mailer.sent == [] and _count(site, "login_links") == 0


def test_a_wrong_play_entry_counts_toward_no_limit_of_the_email(site: Site) -> None:
    site.allow(EMAIL)
    here = site.browser()
    for value in ("Play", "play.", "play." + CLASS_ID.replace("-", "")):
        assert here.post(LINK, json={"email": EMAIL, "return_to": value}).status_code == 422
    assert _count(site, "rate_limits") == 1 and _count(site, "login_links") == 0
    assert _count(site, "audit_events") == 0


def test_the_class_id_is_kept_in_no_row(site: Site) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)  # the account exists, so the request writes an audit event too
    asked = site.browser().post(LINK, json={"email": EMAIL, "return_to": "play." + CLASS_ID})
    assert asked.status_code == 200 and len(site.mailer.sent) == 2
    stored = _every_value(site)
    for needle in (CLASS_ID, CLASS_ID.replace("-", ""), "play.", "return="):
        assert needle not in stored


def test_no_log_line_for_the_request_holds_the_class_id(
    site: Site, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    site.allow(EMAIL)
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    capsys.readouterr()
    sent = ("play." + CLASS_ID, "play." + CLASS_ID.upper(), "play." + CLASS_ID + ".x")
    for value in sent:
        site.browser().post(LINK, json={"email": EMAIL, "return_to": value})
    captured = capsys.readouterr()
    logged = captured.out + captured.err + caplog.text
    lines = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    ours = [line for line in lines if line["logger"].startswith("player_backend")]
    assert [line["path"] for line in ours] == [LINK] * 3
    for needle in (CLASS_ID, CLASS_ID.upper(), CLASS_ID.replace("-", ""), "return_to"):
        assert needle not in logged
    # Its first and last groups on their own too (the shorter ones could occur by chance).
    for group in (CLASS_ID[:8], CLASS_ID[-12:]):
        assert group not in logged
