"""What the site's routes share: the settings, the executor's pool and the mailer.

Set on the application when it starts (app.py). The pool gives handles to data access only.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from fastapi import Request

from player_backend.db.executor import Pool
from player_backend.mail import Mailer
from player_backend.settings import Settings


@dataclass(frozen=True)
class SiteState:
    settings: Settings
    pool: Pool
    mailer: Mailer


def site_state(request: Request) -> SiteState:
    return cast(SiteState, request.app.state.site)
