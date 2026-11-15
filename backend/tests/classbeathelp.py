"""A fake classbeat for the tests (ADR 0010): a signing key made here, ID tokens signed with it,
and a transport that plays classbeat's authorize and token endpoints in memory.

Nothing is fetched or sent over a network: the client under test is given `FakeClassbeat` as
its transport. The authorize step, which a browser would do at classbeat, is `authorize()`
here: it reads the address the site answered and hands back the callback's query.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlencode, urlsplit

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.hashes import SHA256

from player_backend.classbeat_client import ClassbeatClient
from player_backend.classbeat_keys import KeySet
from player_backend.classbeat_settings import ClassbeatSettings
from tests.sitehelp import ISSUER as ISSUER
from tests.sitehelp import ORIGIN

CLIENT_ID = "player-test-client"
# A made-up value, never a real secret: the fake transport ignores it.
CLIENT_SECRET = "fake-client-secret-for-tests"  # noqa: S105
REDIRECT_URI = ORIGIN + "/api/site/sign-in/classbeat/callback"
KID = "test-key-1"

type Claims = dict[str, object]


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def settings() -> ClassbeatSettings:
    return ClassbeatSettings(
        issuer=ISSUER,
        client_id=CLIENT_ID,
        redirect_uri=REDIRECT_URI,
        authorize_url=ISSUER + "/oauth/authorize",
        token_url=ISSUER + "/oauth/token",
        keys_url=ISSUER + "/oauth/jwks",
        client_secret=CLIENT_SECRET,
    )


@dataclass
class SigningKey:
    kid: str = KID
    private: ec.EllipticCurvePrivateKey = field(
        default_factory=lambda: ec.generate_private_key(ec.SECP256R1())
    )

    def jwk(self, **extra: object) -> dict[str, object]:
        numbers = self.private.public_key().public_numbers()
        return {
            "kty": "EC",
            "crv": "P-256",
            "kid": self.kid,
            "use": "sig",
            "alg": "ES256",
            "x": b64url(numbers.x.to_bytes(32, "big")),
            "y": b64url(numbers.y.to_bytes(32, "big")),
            **extra,
        }

    def sign(self, header: Mapping[str, object], claims: Mapping[str, object]) -> str:
        head = b64url(json.dumps(header).encode())
        body = b64url(json.dumps(claims).encode())
        der = self.private.sign(f"{head}.{body}".encode("ascii"), ec.ECDSA(SHA256()))
        r, s = decode_dss_signature(der)
        return f"{head}.{body}." + b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def header(kid: str = KID, **extra: object) -> dict[str, object]:
    return {"alg": "ES256", "typ": "JWT", "kid": kid, **extra}


def claims(nonce: str, now: int, subject: str = "pairwise-subject-1", **extra: object) -> Claims:
    return {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "azp": CLIENT_ID,
        "sub": subject,
        "iat": now,
        "exp": now + 300,
        "auth_time": now,
        "nonce": nonce,
        **extra,
    }


@dataclass
class _Grant:
    nonce: str
    challenge: str
    claims: Claims


@dataclass
class FakeClassbeat:
    """classbeat as the backend sees it. `user` is who signs in at the next `authorize()`."""

    key: SigningKey = field(default_factory=SigningKey)
    clock: Callable[[], float] = time.time
    user: Claims = field(default_factory=lambda: {"sub": "pairwise-subject-1"})
    # Changes made to the next token's claims or header, for the tests of the token check.
    claim_changes: Claims = field(default_factory=dict[str, object])
    header_changes: dict[str, object] = field(default_factory=dict[str, object])
    forms: list[dict[str, str]] = field(default_factory=list[dict[str, str]])
    key_fetches: int = 0
    _grants: dict[str, _Grant] = field(default_factory=dict[str, _Grant])
    authorized: list[dict[str, str]] = field(default_factory=list[dict[str, str]])

    # The transport (classbeat_client.Transport).
    def get_keys(self) -> bytes:
        self.key_fetches += 1
        return json.dumps({"keys": [self.key.jwk()]}).encode()

    def post_token(self, form: Mapping[str, str]) -> bytes:
        self.forms.append(dict(form))
        grant = self._grants.pop(form.get("code", ""), None)
        verifier = form.get("code_verifier", "")
        if grant is None or b64url(hashlib.sha256(verifier.encode()).digest()) != grant.challenge:
            return json.dumps({"error": "invalid_grant"}).encode()
        now = int(self.clock())
        token_claims = {**claims(grant.nonce, now), **grant.claims, **self.claim_changes}
        token = self.key.sign({**header(), **self.header_changes}, token_claims)
        return json.dumps(
            {"id_token": token, "access_token": "unread-access", "token_type": "Bearer"}
        ).encode()

    # What a browser does at classbeat.
    def authorize(self, address: str) -> str:
        """The callback's path and query for the authorize address the site answered."""
        parts = urlsplit(address)
        assert f"{parts.scheme}://{parts.netloc}{parts.path}" == settings().authorize_url
        query = {k: v[0] for k, v in parse_qs(parts.query, strict_parsing=True).items()}
        self.authorized.append(query)
        code = secrets.token_urlsafe(24)
        self._grants[code] = _Grant(query["nonce"], query["code_challenge"], dict(self.user))
        return "/api/site/sign-in/classbeat/callback?" + urlencode(
            {"code": code, "state": query["state"], "iss": ISSUER}
        )


def client(fake: FakeClassbeat, clock: Callable[[], float] = time.time) -> ClassbeatClient:
    return ClassbeatClient(settings(), fake, KeySet(fake.get_keys), clock)
