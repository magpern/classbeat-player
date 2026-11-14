"""The return entry of a sign-in link request, through the site's API (ADR 0006, decisions 1-3):
what is accepted, the order of the answers, the mailed link, and that the value is kept nowhere
(rule 14: a class code only names a session)."""

from __future__ import annotations

import json
import logging

import pytest

from player_backend import login_policy
from player_backend.db import login
from player_backend.logging_setup import configure_logging
from player_backend.login_policy import RETURN_MAX
from tests.dbhelp import every_value
from tests.sitehelp import ORIGIN, Site
from tests.test_return_entry_bound import Spy
from tests.test_return_entry_policy import INVALID

EMAIL = "rider@example.test"
LINK = "/api/site/sign-in/link"
CODE = "BCDF-GHJK"
INVALID_EMAIL = {"error": "invalid_email"}
INVALID_RETURN = {"error": "invalid_return"}


def _links(site: Site) -> int:
    row = site.su.execute("SELECT count(*) FROM player.login_links").fetchone()
    assert row is not None
    assert isinstance(row[0], int)
    return row[0]


def _counters(site: Site) -> int:
    row = site.su.execute("SELECT count(*) FROM player.rate_limits").fetchone()
    assert row is not None
    assert isinstance(row[0], int)
    return row[0]


def _no_sign_in_call(monkeypatch: pytest.MonkeyPatch) -> list[object]:
    """Record what `login.request_link` is given, so a test sees whether it had an email."""
    calls: list[object] = []
    real = login.request_link

    def recording(*args: object, **kwargs: object) -> object:
        calls.append(kwargs["email"])
        return real(*args, **kwargs)  # pyright: ignore[reportArgumentType]

    monkeypatch.setattr(login, "request_link", recording)
    return calls


def _mailed_fragment(site: Site) -> str:
    (mail,) = site.mailer.sent
    (link,) = [word for word in mail.body.split() if word.startswith(ORIGIN)]
    address, _, fragment = link.partition("#")
    assert address == ORIGIN + "/sign-in" and "?" not in link
    return fragment


@pytest.mark.parametrize("body", [{}, {"return_to": None}])
def test_no_return_entry_gives_the_link_as_before(site: Site, body: dict[str, object]) -> None:
    site.allow(EMAIL)
    asked = site.first.post(LINK, json={"email": EMAIL, **body})
    assert asked.status_code == 200 and asked.json() == {"status": "accepted"}
    fragment = _mailed_fragment(site)
    assert "&" not in fragment and "return" not in fragment


@pytest.mark.parametrize("value", ["control", "control." + CODE])
def test_a_return_entry_follows_the_token_in_the_mailed_link(site: Site, value: str) -> None:
    site.allow(EMAIL)
    asked = site.first.post(LINK, json={"email": EMAIL, "return_to": value})
    assert asked.status_code == 200 and asked.json() == {"status": "accepted"}
    token, sep, rest = _mailed_fragment(site).partition("&return=")
    assert sep and rest == value
    # The link still signs in, with the token alone.
    done = site.first.post("/api/site/sign-in/complete", json={"token": token})
    assert done.status_code == 200


def test_an_unknown_address_gets_the_same_answer_with_a_return_entry(site: Site) -> None:
    site.allow(EMAIL)
    body = {"return_to": "control." + CODE}
    allowed = site.first.post(LINK, json={"email": EMAIL, **body})
    unknown = site.browser().post(LINK, json={"email": "stranger@example.test", **body})
    assert (unknown.status_code, unknown.json()) == (allowed.status_code, allowed.json())
    assert [mail.to for mail in site.mailer.sent] == [EMAIL]


@pytest.mark.parametrize("value", INVALID)
def test_a_string_that_is_not_a_return_entry_is_invalid_return(
    site: Site, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    site.allow(EMAIL)
    calls = _no_sign_in_call(monkeypatch)
    refused = site.first.post(LINK, json={"email": EMAIL, "return_to": value})
    assert refused.status_code == 422 and refused.json() == INVALID_RETURN
    assert value == "" or value not in refused.text
    # The data access was given no email, so it stopped before the sign-in call.
    assert calls == [None]
    assert site.mailer.sent == [] and _links(site) == 0


@pytest.mark.parametrize("value", [7, 0, True, False, 1.5, [], ["control"], {}, {"a": "control"}])
def test_a_value_that_is_not_a_string_gets_the_framework_answer(
    site: Site, value: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    site.allow(EMAIL)
    calls = _no_sign_in_call(monkeypatch)
    refused = site.first.post(LINK, json={"email": EMAIL, "return_to": value})
    assert refused.status_code == 422 and refused.json() == {"error": "invalid_request"}
    # Refused while the body is read: no data access at all, so not even the address counted.
    assert calls == [] and _counters(site) == 0
    assert site.mailer.sent == [] and _links(site) == 0


# Over the bound: the longest accepted entry with more after it, and one near the body's cap.
OVER = ["play.3f2a9c4e-8b1d-4e6f-a0c7-5d9e1b2f4a68" + "0" * (RETURN_MAX - 40), "control" * 2000]


@pytest.mark.parametrize("value", OVER)
def test_a_value_over_the_bound_is_invalid_return_in_its_order(
    site: Site, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert len(value) > RETURN_MAX
    site.allow(EMAIL)
    spy = Spy()
    monkeypatch.setattr(login_policy, "RETURN_ENTRY", spy)
    calls = _no_sign_in_call(monkeypatch)
    here = site.browser()
    bad_email = here.post(LINK, json={"email": "not an address", "return_to": value})
    assert bad_email.status_code == 422 and bad_email.json() == INVALID_EMAIL
    refused = here.post(LINK, json={"email": EMAIL, "return_to": value})
    assert refused.status_code == 422 and refused.json() == INVALID_RETURN
    assert value not in refused.text
    # Not `invalid_request` from the body's reading: the data access ran, given no email.
    assert calls == [None, None] and spy.seen == []
    assert site.mailer.sent == [] and _links(site) == 0
    for _ in range(8):  # the rest of the requester's own limit; then the 429 comes first
        assert here.post(LINK, json={"email": EMAIL, "return_to": value}).status_code == 422
    limited = here.post(LINK, json={"email": "not an address", "return_to": value})
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert spy.seen == []


def test_a_bad_email_is_answered_before_a_bad_return_entry(site: Site) -> None:
    for email in ("not an address", "a@"):
        for value in ("", "Control", "control." + CODE.lower(), "/control"):
            refused = site.browser().post(LINK, json={"email": email, "return_to": value})
            assert refused.status_code == 422 and refused.json() == INVALID_EMAIL
        # A good return entry does not change it either.
        refused = site.browser().post(LINK, json={"email": email, "return_to": "control"})
        assert refused.status_code == 422 and refused.json() == INVALID_EMAIL
    assert site.mailer.sent == [] and _links(site) == 0


def test_the_address_limit_is_answered_before_either_422(site: Site) -> None:
    site.allow(EMAIL)
    here = site.browser()
    # Ten refused requests count toward the requester's own limit like any other.
    for n in range(10):
        bad = {"email": "not an address"} if n % 2 else {"email": EMAIL, "return_to": "control.x"}
        assert here.post(LINK, json=bad).status_code == 422
    over = [
        {"email": "not an address"},
        {"email": EMAIL, "return_to": "Control"},
        {"email": "not an address", "return_to": "Control"},
        {"email": EMAIL, "return_to": "control"},
    ]
    for body in over:
        limited = here.post(LINK, json=body)
        assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert site.mailer.sent == [] and _links(site) == 0


def test_neither_422_counts_toward_the_limits_of_the_email(site: Site) -> None:
    site.allow(EMAIL)
    here = site.browser()
    for value in ("Control", "control.BCDFGHJK", ""):
        assert here.post(LINK, json={"email": EMAIL, "return_to": value}).status_code == 422
    assert here.post(LINK, json={"email": "x", "return_to": "Control"}).status_code == 422
    # Only the requester's own counter: nothing of the email, no link row, no event.
    assert _counters(site) == 1 and _links(site) == 0
    assert site.su.execute("SELECT count(*) FROM player.audit_events").fetchone() == (0,)
    # Three links in 15 minutes per email and address: all three are still there.
    sent = [site.ask(here, EMAIL) is not None for _ in range(4)]
    assert sent == [True, True, True, False]


def test_the_return_entry_is_kept_in_no_column_and_no_row(site: Site) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)  # the account exists, so the request writes an audit event too
    browser = site.browser()
    asked = browser.post(LINK, json={"email": EMAIL, "return_to": "control." + CODE})
    assert asked.status_code == 200 and len(site.mailer.sent) == 2
    assert _links(site) == 1
    stored = every_value(site.su)
    for needle in (CODE, CODE.replace("-", ""), "return="):
        assert needle not in stored
    columns = site.su.execute(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') "
        "AND (column_name LIKE '%%return%%' OR column_name LIKE '%%control%%')"
    ).fetchall()
    assert columns == []


def test_no_log_line_for_the_request_holds_the_class_code(
    site: Site, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    site.allow(EMAIL)
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    capsys.readouterr()
    for value in ("control." + CODE, "control." + CODE.lower(), "control." + CODE + ".x"):
        site.browser().post(LINK, json={"email": EMAIL, "return_to": value})
    captured = capsys.readouterr()
    logged = captured.out + captured.err + caplog.text
    lines = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    ours = [line for line in lines if line["logger"].startswith("player_backend")]
    assert [line["path"] for line in ours] == [LINK] * 3
    for needle in (CODE, CODE.lower(), CODE.replace("-", ""), "return_to"):
        assert needle not in logged
