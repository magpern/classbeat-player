"""The mailer used until a mail service is configured: it sends nothing.

It logs that a mail was dropped and nothing of the mail: a sign-in mail holds a token.
"""

from __future__ import annotations

import logging

from player_backend.mail import Mail

_log = logging.getLogger("player_backend.mail")


class NoMailer:
    def send(self, mail: Mail) -> None:
        _log.warning("mail dropped", extra={"fields": {"event": "mail.not_configured"}})
