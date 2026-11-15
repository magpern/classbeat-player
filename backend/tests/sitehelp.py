"""The site under test: the real app on the executor's pool as player_app, with a fake mailer.

Nothing here touches a network: requests go to the app in-process (httpx's ASGI transport), and
the database is the throwaway one of conftest.py. Rows the app commits are removed before and
after every test. Tokens are whatever the app made at run time.
"""

from __future__ import annotations

import asyncio
import secrets
import time
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import cast

import httpx
import psycopg
from fastapi import FastAPI

from player_backend.app import create_app
from player_backend.classbeat_client import ClassbeatClient
from player_backend.classbeat_policy import Identity
from player_backend.client_policy import Network, address_hash, client_address, client_info
from player_backend.db import classbeat, site_sessions
from player_backend.live.recheck import RecheckTiming
from player_backend.mail import Mail
from player_backend.settings import Settings
from player_backend.site.state import SiteState
from player_backend.source_policy import KnownSource
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from tests.dbhelp import Conn

ORIGIN = "https://player.test"
# classbeat as the tests' sign-in provider (ADR 0010): a made-up address, never contacted.
ISSUER = "https://classbeat.test"
ADDRESS = "203.0.113.7"
SESSION_COOKIE = "__Host-cbp_session"
LOGIN_COOKIE = "__Host-cbp_login"
FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"
SAME_ORIGIN = {"Origin": ORIGIN, "User-Agent": FIREFOX}
# The one known source of the tests (ADR 0002, section 7): a made-up address, never contacted.
SOURCE = KnownSource("classbeat", "classbeat", frozenset({"https://classbeat.test/player/linked"}))

_CLEAN = (
    "TRUNCATE player.accounts, player.login_links, player.login_challenges, player.pairings, "
    "player.source_link_codes, player.rate_limits, player.signup_allowlist, "
    "player.classbeat_sign_ins, player.classbeat_event_ids CASCADE"
)


@dataclass
class RecordingMailer:
    sent: list[Mail] = field(default_factory=list[Mail])

    timeouts: list[float] = field(default_factory=list[float])

    def send(self, mail: Mail, *, timeout: float) -> None:
        self.timeouts.append(timeout)
        self.sent.append(mail)


class Browser:
    """One browser: a cookie jar of its own and the address its requests come from."""

    def __init__(
        self,
        app: FastAPI,
        loop: asyncio.AbstractEventLoop,
        address: str,
        headers: Mapping[str, str],
        raise_errors: bool,
    ) -> None:
        transport = httpx.ASGITransport(
            app=app, client=(address, 40000), raise_app_exceptions=raise_errors
        )
        self._loop = loop
        self.address = address
        self.user_agent = headers.get("User-Agent")
        self._client = httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers=headers)

    @property
    def cookies(self) -> httpx.Cookies:
        return self._client.cookies

    def take_cookies(self, other: Browser) -> None:
        """Hold the same cookies as `other`: a copied, or a stolen, jar."""
        for name, value in other.cookies.items():
            self.cookies.set(name, value, domain="player.test")

    def request(
        self,
        method: str,
        path: str,
        *,
        json: object = None,
        content: bytes | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        """`json` is sent as `application/json`; `content` as it is, with no `Content-Type`."""
        return self._loop.run_until_complete(
            self._client.request(method, path, json=json, content=content, headers=headers)
        )

    def get(self, path: str, *, headers: Mapping[str, str] | None = None) -> httpx.Response:
        return self.request("GET", path, headers=headers)

    def post(
        self,
        path: str,
        *,
        json: object = None,
        content: bytes | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        return self.request("POST", path, json=json, content=content, headers=headers)

    def delete(self, path: str, *, headers: Mapping[str, str] | None = None) -> httpx.Response:
        return self.request("DELETE", path, headers=headers)


@dataclass
class Site:
    app: FastAPI
    mailer: RecordingMailer
    su: Conn  # the tests' own superuser connection, autocommit
    loop: asyncio.AbstractEventLoop
    first: Browser = field(init=False)

    def __post_init__(self) -> None:
        self.first = self.browser()

    def browser(
        self,
        address: str = ADDRESS,
        *,
        headers: Mapping[str, str] = SAME_ORIGIN,
        raise_errors: bool = True,
    ) -> Browser:
        """A browser of its own: no cookies yet, same-origin requests from `address`."""
        return Browser(self.app, self.loop, address, headers, raise_errors)

    def allow(self, email: str) -> None:
        self.su.execute("INSERT INTO player.signup_allowlist (email) VALUES (%s)", (email,))

    def ask(self, browser: Browser, email: str) -> str | None:
        """Ask for a link. Returns the token of the mail that was sent, or None without one."""
        before = len(self.mailer.sent)
        response = browser.post("/api/site/sign-in/link", json={"email": email})
        assert response.status_code == 200 and response.json() == {"status": "accepted"}
        new = self.mailer.sent[before:]
        if not new:
            return None
        assert len(new) == 1 and new[0].to == email
        return link_token(new[0])

    def sign_in(self, email: str, browser: Browser | None = None) -> Browser:
        """A browser signed in to `email` as an instructor (ADR 0010, sections 4 and 5): on the
        allowlist, or an instructor already, with the subject `subject_of(email)`.

        Made by the call the classbeat callback makes once it has checked the ID token
        (`db.classbeat.complete`), on the app's own pool; the browser's earlier session is ended
        as the callback ends it. The whole flow, with the fake classbeat, is tested in
        tests/test_classbeat_sign_in.py.
        """
        browser = browser or self.browser()
        state = cast(SiteState, self.app.state.site)
        address = client_address(browser.address, None, ())
        info = client_info(address, browser.user_agent)
        token = new_token("ses")
        outcome = classbeat.complete(
            state.pool,
            identity=Identity(ISSUER, subject_of(email), email, int(time.time())),
            session_hash=token_hash(token),
            address_hash=address_hash(address),
            client=info,
        )
        assert outcome == "signed_in", outcome
        held = browser.cookies.get(SESSION_COOKIE)
        if held is not None:
            site_sessions.end_asking_session(state.pool, token_hash(held), info)
        browser.cookies.set(SESSION_COOKIE, token, domain="player.test")
        return browser

    def follower(self, email: str) -> None:
        """An account of kind `follower`, the one kind the email link and passkeys are open
        for (ADR 0010, section 7). No function makes one yet, so the tests' superuser does,
        to test the code behind the refusal."""
        self.su.execute(
            "INSERT INTO player.accounts (kind, email, passkey_user_handle) "
            "VALUES ('follower', %s, %s)",
            (email, secrets.token_bytes(32)),
        )

    def link_sign_in(self, email: str, browser: Browser | None = None) -> Browser:
        """A browser signed in to the follower `email` by the email link (ADR 0002, section 4)."""
        browser = browser or self.browser()
        token = self.ask(browser, email)
        assert token is not None
        response = browser.post("/api/site/sign-in/complete", json={"token": token})
        assert response.status_code == 200, response.text
        return browser

    def events(self, email: str) -> list[tuple[str, object]]:
        """(event, detail) of the account's audit events, oldest first."""
        found = self.su.execute(
            "SELECT e.event, e.detail FROM player.audit_events e JOIN player.accounts a "
            "ON a.id = e.account_id WHERE a.email = %s ORDER BY e.occurred_at, e.event",
            (email,),
        ).fetchall()
        return [(str(event), detail) for event, detail in found]


def subject_of(email: str) -> str:
    """The classbeat subject of the tests' instructor with `email`: one per email."""
    return "subject-" + email


def link_token(mail: Mail) -> str:
    """The token of a sign-in mail: the fragment of its one link."""
    links = [word for word in mail.body.split() if word.startswith(ORIGIN)]
    assert len(links) == 1
    address, _, fragment = links[0].partition("#")
    assert address == ORIGIN + "/sign-in" and "?" not in links[0]
    return fragment


@contextmanager
def running_site(
    app_url: str,
    db_url: str,
    proxies: tuple[Network, ...] = (),
    live_recheck: RecheckTiming | None = None,
    live_default: bool = False,
    classbeat: ClassbeatClient | None = None,
) -> Generator[Site]:
    """The app under test. Without `live_recheck` it runs no live re-check loop: a test that
    needs one passes its timing (tests/test_live_recheck.py). `live_default` builds the app as
    production does, with `create_app`'s own default (the 30-second loop). `classbeat` is the
    sign-in provider's client, over a fake transport (tests/classbeathelp.py)."""
    mailer = RecordingMailer()
    settings = Settings(
        database_url=app_url, site_origin=ORIGIN, trusted_proxies=proxies, sources=(SOURCE,)
    )
    app = (
        create_app(settings, mailer, classbeat=classbeat)
        if live_default
        else create_app(settings, mailer, live_recheck, classbeat=classbeat)
    )
    loop = asyncio.new_event_loop()
    started = app.router.lifespan_context(app)  # the app's start and stop: the pool
    with psycopg.connect(db_url, autocommit=True) as su:
        su.execute(_CLEAN)
        loop.run_until_complete(started.__aenter__())
        try:
            yield Site(app=app, mailer=mailer, su=su, loop=loop)
        finally:
            loop.run_until_complete(started.__aexit__(None, None, None))
            loop.close()
            su.execute(_CLEAN)
