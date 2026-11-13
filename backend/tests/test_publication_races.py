"""Two sends of one class at once (ADR 0002, section 7): the decision is made under the class
row's lock, which exists from the first publication on, so two sends never cross.

The first send's transaction is held open; the second, in another thread, is seen to wait for
it and then to decide against what the first one committed.
"""

from __future__ import annotations

import json
import threading
from typing import cast

from player_backend.class_schemas import schemas
from player_backend.db import classes, sources
from player_backend.db.executor import Pool
from player_backend.publication_policy import Publication, check
from player_backend.site.state import SiteState
from player_backend.token_policy import token_hash
from tests import sourcehelp as sh
from tests.sitehelp import Site

EMAIL = "teacher@example.test"


def _pub(class_id: str, number: int, title: str) -> Publication:
    found = check(
        json.dumps(sh.envelope(class_id, number, sh.document(title))).encode(), *schemas()
    )
    assert isinstance(found, Publication)
    return found


def _race(
    site: Site, first: Publication, second: Publication, before: Publication | None = None
) -> tuple[str, str]:
    """`first` held open while `second` is sent; `before`, when given, committed ahead of both."""
    site.allow(EMAIL)
    digest = token_hash(sh.link(site, site.sign_in(EMAIL)))
    pool = cast(SiteState, site.app.state.site).pool
    outcomes: list[str] = []
    if before is not None:
        with sources.entered_again(pool, digest) as entry:
            assert entry is not None
            assert classes.publish(entry.context, entry.source_id, before).outcome == "applied"

    def other(pool: Pool) -> None:
        with sources.entered_again(pool, digest) as entry:
            assert entry is not None
            outcomes.append(classes.publish(entry.context, entry.source_id, second).outcome)

    with sources.entered_again(pool, digest) as entry:
        assert entry is not None
        mine = classes.publish(entry.context, entry.source_id, first).outcome
        thread = threading.Thread(target=other, args=(pool,))
        thread.start()
        thread.join(timeout=0.5)
        # Still waiting for the first send's lock.
        assert thread.is_alive() and outcomes == []
    thread.join(timeout=10)
    assert not thread.is_alive()
    return mine, outcomes[0]


def test_two_first_sends_of_one_class_never_cross(site: Site) -> None:
    assert _race(site, _pub("c1", 1, "A"), _pub("c1", 1, "B")) == ("applied", "conflict")
    assert sh.class_rows(site, EMAIL) == [("c1", 1, "class", "A", 1)]


def test_an_older_send_waiting_behind_a_newer_one_is_stale(site: Site) -> None:
    assert _race(site, _pub("c1", 5, "New"), _pub("c1", 4, "Old")) == ("applied", "stale")
    assert sh.class_rows(site, EMAIL) == [("c1", 5, "class", "New", 1)]


def test_a_send_waits_for_the_row_lock_of_a_send_that_wrote_nothing(site: Site) -> None:
    # The class exists and the first send is a repeat: it writes no row, so only the lock of
    # `SELECT ... FOR UPDATE` holds the second send back (an insert or an update would make it
    # wait on its own). The second then decides against the row as it stands.
    first = _pub("c1", 1, "A")
    found = _race(site, first, _pub("c1", 4, "B"), before=first)
    assert found == ("repeat", "applied")
    assert sh.class_rows(site, EMAIL) == [("c1", 4, "class", "B", 2)]
