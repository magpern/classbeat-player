"""One time limit for a whole SMTP conversation: connect, TLS and every command (issue #83).

A socket timeout alone bounds each read, not the conversation: a server that answers one byte
at a time could hold the thread for good. So every step gets the time that is left as its
socket timeout, and a watchdog shuts the connection down when the limit is reached, which ends
a read that is still waiting. The name lookup cannot be interrupted, so the mailer waits for it
no longer than the time left (smtp_mailer.py, `_addresses`).
"""

from __future__ import annotations

import socket
import threading
import time
from types import TracebackType
from typing import Self


class Deadline:
    """Used as `with Deadline(seconds) as deadline:` around one conversation."""

    def __init__(self, seconds: float) -> None:
        self._end = time.monotonic() + seconds
        self._lock = threading.Lock()
        self._sock: socket.socket | None = None
        self._expired = False
        self._timer = threading.Timer(max(seconds, 0.0), self._cut)
        self._timer.daemon = True

    def __enter__(self) -> Self:
        self._timer.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._timer.cancel()

    @property
    def expired(self) -> bool:
        with self._lock:
            return self._expired or time.monotonic() >= self._end

    def left(self) -> float:
        """The seconds that are left. Raises `TimeoutError` when there are none."""
        left = self._end - time.monotonic()
        if left <= 0 or self.expired:
            raise TimeoutError("the mail service took too long")
        return left

    def hold(self, sock: socket.socket) -> None:
        """Watch `sock` (the one the conversation now uses) and give it the time that is left."""
        with self._lock:
            self._sock = sock
            if self._expired:
                self._shut(sock)
        sock.settimeout(self.left())

    def release(self) -> None:
        """Watch no socket any more. Called before a socket is closed: the watchdog shuts a
        socket down under the lock, so once this returns it never acts on a closed socket's
        descriptor, which the system may by then have given to another file."""
        with self._lock:
            self._sock = None

    def step(self) -> None:
        """Before each command: the socket gets the time that is left."""
        with self._lock:
            sock = self._sock
        left = self.left()
        if sock is not None:
            sock.settimeout(left)

    def _cut(self) -> None:
        with self._lock:
            self._expired = True
            if self._sock is not None:
                self._shut(self._sock)

    @staticmethod
    def _shut(sock: socket.socket) -> None:
        # The plain socket's shutdown, also for a TLS socket: it acts on the descriptor only,
        # so it is safe while another thread is reading, and that read then ends.
        try:
            socket.socket.shutdown(sock, socket.SHUT_RDWR)
        except OSError:
            pass
