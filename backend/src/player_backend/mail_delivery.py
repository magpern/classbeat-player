"""Handing a mail to the mailer after the response has been sent.

The one caller of `Mailer.send`. It gives the mailer its time limit, and when the mailer fails
it logs that a mail was not sent and nothing of the mail: a sign-in mail holds a token and an
address, and an error's message or traceback can quote either. So the log line holds the
error's type only, and the error goes no further (the server would log it whole).
"""

from __future__ import annotations

import logging
from typing import Final

from player_backend.mail import Mail, Mailer

# How long one `send` may take. The mailer runs in the server's thread pool, so a mail service
# that hangs would otherwise hold a thread for good.
SEND_TIMEOUT_SECONDS: Final = 10.0

_log = logging.getLogger("player_backend.mail")


def deliver(mailer: Mailer, mail: Mail) -> None:
    try:
        mailer.send(mail, timeout=SEND_TIMEOUT_SECONDS)
    except Exception as error:
        # No `exc_info`: a handler that prints tracebacks would print the error's message.
        _log.error(
            "mail not sent: %s", type(error).__name__, extra={"fields": {"event": "mail.failed"}}
        )
