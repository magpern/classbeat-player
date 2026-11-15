"""An instructor classbeat gave no email (ADR 0010, section 8; #496): pairing a device, the
export and the deletion all work, with "your classbeat account" in the email's place."""

from __future__ import annotations

import pytest

from player_backend.account_policy import NO_EMAIL
from tests import pairhelp
from tests.accounthelp import DELETE, EXPORT
from tests.sitehelp import ISSUER, Browser, Site, subject_of

EMAIL = "gone@example.test"


def _no_email(site: Site) -> Browser:
    """A signed-in instructor whose email classbeat no longer gives."""
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    site.su.execute(
        "UPDATE player.accounts SET email = NULL "
        "WHERE kind = 'instructor' AND classbeat_issuer = %s AND classbeat_subject = %s",
        (ISSUER, subject_of(EMAIL)),
    )
    return browser


def test_collecting_a_pairing_gives_the_token_a_null_email_and_sends_no_mail(site: Site) -> None:
    browser = _no_email(site)
    pairing = pairhelp.start(site)
    assert pairhelp.approve(browser, pairing).status_code == 200
    before = len(site.mailer.sent)
    answer = pairhelp.poll(pairing)
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["email"] is None and isinstance(body["device_token"], str)
    assert len(site.mailer.sent) == before
    device = pairing.app.get(pairhelp.DEVICE, headers=pairhelp.bearer(body["device_token"]))
    assert device.status_code == 200


def test_the_export_works_with_no_email(site: Site) -> None:
    browser = _no_email(site)
    answer = browser.post(EXPORT)
    assert answer.status_code == 200, answer.text
    assert answer.json()["account"]["email"] is None


@pytest.mark.parametrize("typed", [EMAIL, "", "null", "None", "your account"])
def test_the_deletion_refuses_anything_but_the_words_shown(site: Site, typed: str) -> None:
    browser = _no_email(site)
    answer = browser.post(DELETE, json={"confirm": typed})
    assert answer.status_code == 422 and answer.json() == {"error": "confirmation_mismatch"}
    assert site.su.execute("SELECT count(*) FROM player.accounts").fetchone() == (1,)


@pytest.mark.parametrize("typed", [NO_EMAIL, " Your classbeat Account "])
def test_the_deletion_takes_your_classbeat_account(site: Site, typed: str) -> None:
    browser = _no_email(site)
    answer = browser.post(DELETE, json={"confirm": typed})
    assert answer.status_code == 204, answer.text
    assert site.su.execute("SELECT count(*) FROM player.accounts").fetchone() == (0,)
