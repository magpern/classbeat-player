"""A software authenticator for the tests, and the site's passkey routes driven with it.

`Authenticator` makes a key pair at run time (ES256, EdDSA or RS256) and answers WebAuthn's
create and get options as a browser would hand them back, in WebAuthn's JSON form. Nothing here
touches a network or a real authenticator: every byte is made in the test's own process.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from typing import Literal

import cbor2
import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from tests.sitehelp import ORIGIN, Browser

type Algorithm = Literal["ES256", "EdDSA", "RS256", "ES384"]

PASSKEYS = "/api/site/passkeys"
OPTIONS = "/api/site/passkeys/options"
SIGN_IN_OPTIONS = "/api/site/sign-in/passkey/options"
SIGN_IN = "/api/site/sign-in/passkey"
# Authenticator data flags: user present, user verified, attested credential data.
UP, UV, AT = 0x01, 0x04, 0x40


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class Authenticator:
    """One passkey on one authenticator. `step` is how far its counter moves per use (0: a
    passkey that keeps no counter, as many synced ones do)."""

    def __init__(self, algorithm: Algorithm = "ES256", *, step: int = 1) -> None:
        self.algorithm = algorithm
        self.step = step
        self.counter = 0
        self.credential_id = secrets.token_bytes(32)
        self.user_handle = b""
        if algorithm == "ES256":
            self._ec = ec.generate_private_key(ec.SECP256R1())
        elif algorithm == "ES384":
            self._ec = ec.generate_private_key(ec.SECP384R1())
        elif algorithm == "EdDSA":
            self._ed = ed25519.Ed25519PrivateKey.generate()
        else:
            self._rsa = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def cose_key(self) -> bytes:
        if self.algorithm in ("ES256", "ES384"):
            numbers = self._ec.public_key().public_numbers()
            size, alg, crv = (32, -7, 1) if self.algorithm == "ES256" else (48, -35, 2)
            return cbor2.dumps(
                {
                    1: 2,
                    3: alg,
                    -1: crv,
                    -2: numbers.x.to_bytes(size, "big"),
                    -3: numbers.y.to_bytes(size, "big"),
                }
            )
        if self.algorithm == "EdDSA":
            raw = self._ed.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
            return cbor2.dumps({1: 1, 3: -8, -1: 6, -2: raw})
        public = self._rsa.public_key().public_numbers()
        n = public.n.to_bytes((public.n.bit_length() + 7) // 8, "big")
        e = public.e.to_bytes((public.e.bit_length() + 7) // 8, "big")
        return cbor2.dumps({1: 3, 3: -257, -1: n, -2: e})

    def _sign(self, data: bytes) -> bytes:
        if self.algorithm == "ES256":
            return self._ec.sign(data, ec.ECDSA(hashes.SHA256()))
        if self.algorithm == "ES384":
            return self._ec.sign(data, ec.ECDSA(hashes.SHA384()))
        if self.algorithm == "EdDSA":
            return self._ed.sign(data)
        return self._rsa.sign(data, padding.PKCS1v15(), hashes.SHA256())

    def create(
        self,
        options: dict[str, object],
        *,
        origin: str = ORIGIN,
        rp_id: str | None = None,
        verified: bool = True,
    ) -> dict[str, object]:
        """The answer to `navigator.credentials.create()` with `options` (attestation `none`)."""
        rp = options["rp"]
        user = options["user"]
        assert isinstance(rp, dict) and isinstance(user, dict)
        rp_id = rp_id or str(rp["id"])  # pyright: ignore[reportUnknownArgumentType]
        self.user_handle = unb64(str(user["id"]))  # pyright: ignore[reportUnknownArgumentType]
        client_data = _client_data("webauthn.create", str(options["challenge"]), origin)
        flags = UP | AT | (UV if verified else 0)
        auth_data = (
            hashlib.sha256(rp_id.encode()).digest()
            + bytes([flags])
            + self.counter.to_bytes(4, "big")
            + bytes(16)  # the AAGUID: none
            + len(self.credential_id).to_bytes(2, "big")
            + self.credential_id
            + self.cose_key()
        )
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "id": b64(self.credential_id),
            "rawId": b64(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64(client_data),
                "attestationObject": b64(attestation),
                "transports": ["internal", "hybrid", "carrier-pigeon"],
            },
            "authenticatorAttachment": "platform",
        }

    def get(
        self,
        options: dict[str, object],
        *,
        origin: str = ORIGIN,
        rp_id: str | None = None,
        verified: bool = True,
        counter: int | None = None,
        credential_id: bytes | None = None,
    ) -> dict[str, object]:
        """The answer to `navigator.credentials.get()` with `options`."""
        rp_id = rp_id or str(options["rpId"])
        if counter is None:
            self.counter += self.step
            counter = self.counter
        client_data = _client_data("webauthn.get", str(options["challenge"]), origin)
        auth_data = (
            hashlib.sha256(rp_id.encode()).digest()
            + bytes([UP | (UV if verified else 0)])
            + counter.to_bytes(4, "big")
        )
        signature = self._sign(auth_data + hashlib.sha256(client_data).digest())
        named = credential_id or self.credential_id
        return {
            "id": b64(named),
            "rawId": b64(named),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64(client_data),
                "authenticatorData": b64(auth_data),
                "signature": b64(signature),
                "userHandle": b64(self.user_handle),
            },
            "authenticatorAttachment": "platform",
        }


def _client_data(kind: str, challenge: str, origin: str) -> bytes:
    return json.dumps(
        {"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": False}
    ).encode()


def options_of(response: httpx.Response) -> dict[str, object]:
    assert response.status_code == 200, response.text
    found = response.json()
    assert isinstance(found, dict)
    return found  # pyright: ignore[reportUnknownVariableType]


def register(
    browser: Browser, authenticator: Authenticator, name: str = "Laptop"
) -> httpx.Response:
    """Add `authenticator`'s passkey to the account `browser` is signed in to."""
    credential = authenticator.create(options_of(browser.post(OPTIONS)))
    return browser.post(PASSKEYS, json={"name": name, "credential": credential})


def sign_in(browser: Browser, authenticator: Authenticator, **answer: object) -> httpx.Response:
    """Ask for a sign-in challenge and answer it; `answer` goes to `Authenticator.get`."""
    options = options_of(browser.post(SIGN_IN_OPTIONS))
    credential = authenticator.get(options, **answer)  # pyright: ignore[reportArgumentType]
    return browser.post(SIGN_IN, json={"credential": credential})
