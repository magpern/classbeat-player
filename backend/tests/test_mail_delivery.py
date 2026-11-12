"""The mailer interface (mail.py, mail_delivery.py): `send` gets a time limit, and a `send` that
fails after the response has been sent is logged without anything of the mail.

Fake mailers only: nothing here sends anything.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, replace

import pytest

from player_backend.logging_setup import configure_logging
from player_backend.login_policy import sign_in_mail
from player_backend.mail import Mail, Mailer
from player_backend.mail_delivery import SEND_TIMEOUT_SECONDS, deliver
from player_backend.token_issue import new_token
from tests.sitehelp import ORIGIN, Site, link_token

EMAIL = "rider@example.test"
LINK = "/api/site/sign-in/link"


@dataclass
class FailingMailer:
    """Raises an error that quotes the whole mail, as a careless mail client might."""

    error: type[Exception] = RuntimeError
    got: list[Mail] = field(default_factory=list[Mail])
    timeouts: list[float] = field(default_factory=list[float])

    def send(self, mail: Mail, *, timeout: float) -> None:
        self.got.append(mail)
        self.timeouts.append(timeout)
        raise self.error(f"no delivery to {mail.to}: {mail.subject}: {mail.body}")


def _use(site: Site, mailer: Mailer) -> None:
    site.app.state.site = replace(site.app.state.site, mailer=mailer)


def _nothing_of_the_mail(logged: str, mail: Mail) -> None:
    token = link_token(mail)
    assert token not in logged and token.split("_", 2)[2] not in logged
    assert mail.to not in logged and mail.subject not in logged
    assert "sign-in#" not in logged and "no delivery" not in logged
    for line in mail.body.splitlines():
        assert not line.strip() or line not in logged


def test_send_gets_the_time_limit(site: Site) -> None:
    site.allow(EMAIL)
    assert site.ask(site.first, EMAIL) is not None
    assert site.mailer.timeouts == [SEND_TIMEOUT_SECONDS]
    assert 0 < SEND_TIMEOUT_SECONDS <= 30


@pytest.mark.parametrize("error", [RuntimeError, TimeoutError, OSError])
def test_a_send_that_fails_is_logged_without_anything_of_the_mail(
    site: Site,
    error: type[Exception],
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    mailer = FailingMailer(error)
    _use(site, mailer)
    site.allow(EMAIL)
    # The browser raises whatever the app lets out: the failure stays inside.
    accepted = site.first.post(LINK, json={"email": EMAIL})
    assert accepted.status_code == 200 and accepted.json() == {"status": "accepted"}
    (mail,) = mailer.got
    assert mailer.timeouts == [SEND_TIMEOUT_SECONDS]

    captured = capsys.readouterr()
    lines = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    failed = [line for line in lines if line.get("event") == "mail.failed"]
    assert len(failed) == 1
    assert failed[0]["level"] == "ERROR" and failed[0]["logger"] == "player_backend.mail"
    assert failed[0]["message"] == f"mail not sent: {error.__name__}"
    assert "exception" not in failed[0]
    _nothing_of_the_mail(captured.out + captured.err + caplog.text, mail)
    # The request itself is logged as answered, and the site still works.
    assert [line["status"] for line in lines if line["logger"] == "player_backend.access"] == [200]
    assert site.first.post(LINK, json={"email": EMAIL}).status_code == 200


def test_the_failing_send_runs_after_the_response_has_been_sent(site: Site) -> None:
    order: list[str] = []

    class Late:
        def send(self, mail: Mail, *, timeout: float) -> None:
            order.append("send")
            raise RuntimeError(mail.body)

    _use(site, Late())
    site.allow(EMAIL)
    body = json.dumps({"email": EMAIL}).encode()

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        if message["type"] == "http.response.start":
            assert message["status"] == 200
        if message["type"] == "http.response.body" and not message.get("more_body"):
            order.append("response")

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": LINK,
        "raw_path": LINK.encode(),
        "query_string": b"",
        "headers": [
            (b"host", b"player.test"),
            (b"origin", ORIGIN.encode()),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
        "client": ("203.0.113.7", 40000),
        "server": ("player.test", 443),
    }
    # Nothing is raised out of the app, although the mailer failed.
    site.loop.run_until_complete(site.app(scope, receive, send))  # pyright: ignore[reportArgumentType]
    assert order == ["response", "send"]


def test_deliver_swallows_the_failure_and_returns(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    mailer = FailingMailer()
    mail = sign_in_mail(ORIGIN, EMAIL, new_token("ml"))
    deliver(mailer, mail)
    assert mailer.got == [mail]
    assert [record.getMessage() for record in caplog.records] == ["mail not sent: RuntimeError"]
    assert all(record.exc_info is None for record in caplog.records)
    _nothing_of_the_mail(caplog.text, mail)
