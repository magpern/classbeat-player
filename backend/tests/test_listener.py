"""The executor's listening connection (executor/_listen.py; ADR 0002, section 8): a connection
of its own that hears the notices of committed transactions only, hands out payloads as text,
and refuses to wait once it is closed."""

from __future__ import annotations

import psycopg
import pytest

from player_backend.db import live
from player_backend.db.executor import DatabaseError, HandleClosed, Listener


def test_it_hears_committed_notices_only(app_url: str, db_url: str) -> None:
    with live.listening(app_url) as listener, psycopg.connect(db_url) as other:
        assert listener.wait(0.05) == []
        other.execute("SELECT pg_notify('live_revocations', 'rolled back')")
        other.rollback()
        assert listener.wait(0.3) == []
        other.execute("SELECT pg_notify('live_revocations', 'one')")
        other.execute("SELECT pg_notify('live_revocations', 'two')")
        other.commit()
        heard = listener.wait(2.0)
        heard += listener.wait(0.1) if len(heard) < 2 else []
        assert heard == ["one", "two"]
        other.execute("SELECT pg_notify('another_channel', 'three')")
        other.commit()
        assert listener.wait(0.3) == []


def test_a_closed_listener_refuses_and_a_lost_one_raises(app_url: str, db_url: str) -> None:
    with live.listening(app_url) as listener:
        with psycopg.connect(db_url, autocommit=True) as su:
            su.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE usename = 'player_app' AND query = 'LISTEN live_revocations'"
            )
        with pytest.raises(DatabaseError):
            listener.wait(2.0)
    with pytest.raises(HandleClosed):
        listener.wait(0.0)
    with pytest.raises(HandleClosed):
        Listener().wait(0.0)
