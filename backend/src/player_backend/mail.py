"""The mail interface. Which mail service stands behind it is the owner's to choose (owner.md)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    # May hold a token: never shown, never logged.
    body: str = field(repr=False)


class Mailer(Protocol):
    def send(self, mail: Mail, *, timeout: float) -> None:
        """Hand one mail over for delivery. Called after the response has been sent.

        Gives up and raises once `timeout` seconds have passed: a mail service that hangs must
        not hold the thread that called. Called through `deliver` (mail_delivery.py) only.
        """
        ...
