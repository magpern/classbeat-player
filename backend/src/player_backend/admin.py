"""The operator's commands, run on the server as player_owner (ADR 0002, section 9).

    python -m player_backend.admin allowlist add <email>
    python -m player_backend.admin allowlist remove <email>
    python -m player_backend.admin allowlist list
    python -m player_backend.admin purge

They connect with `PLAYER_DATABASE_OWNER_URL` (as the migration runner does) and refuse any
other role. `purge` calls `auth_purge_expired()` once; the deploy runs it every hour (README,
"Operator commands"). Output goes to the operator's terminal only, never to a log. A database
error is shown by its type and SQLSTATE, never by its message.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence
from typing import TextIO

from player_backend.db.executor import DatabaseError
from player_backend.db.operator import (
    NotOperatorRole,
    allowlist_add,
    allowlist_list,
    allowlist_remove,
    operator_handle,
    purge_expired,
)
from player_backend.login_policy import normalise_email

OWNER_URL_VARIABLE = "PLAYER_DATABASE_OWNER_URL"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m player_backend.admin")
    commands = parser.add_subparsers(dest="command", required=True)
    allowlist = commands.add_parser("allowlist", help="the sign-up allowlist")
    actions = allowlist.add_subparsers(dest="action", required=True)
    actions.add_parser("add", help="let an email create an account").add_argument("email")
    actions.add_parser("remove", help="take an email off the list").add_argument("email")
    actions.add_parser("list", help="the listed emails")
    commands.add_parser("purge", help="remove what is past its time, once")
    return parser


def main(
    argv: Sequence[str] | None = None, *, out: TextIO = sys.stdout, err: TextIO = sys.stderr
) -> int:
    args = _parser().parse_args(argv)
    email: str | None = None
    if args.command == "allowlist" and args.action in ("add", "remove"):
        email = normalise_email(str(args.email))
        if email is None:
            print("not an email address", file=err)
            return 2
    url = os.environ.get(OWNER_URL_VARIABLE, "").strip()
    if not url:
        print(f"{OWNER_URL_VARIABLE} is required", file=err)
        return 2
    try:
        with operator_handle(url) as db:
            if args.command == "purge":
                purge_expired(db)
                print("purged expired rows", file=out)
            elif args.action == "list":
                for listed, added_at in allowlist_list(db):
                    print(f"{listed}\t{added_at.isoformat()}", file=out)
            elif args.action == "add" and email is not None:
                done = allowlist_add(db, email)
                print(f"{'added' if done else 'already listed'}: {email}", file=out)
            elif email is not None:
                done = allowlist_remove(db, email)
                print(f"{'removed' if done else 'not listed'}: {email}", file=out)
    except NotOperatorRole as refused:
        print(str(refused), file=err)
        return 1
    except DatabaseError as error:
        print(f"database error: {type(error).__name__} {error.sqlstate or ''}".rstrip(), file=err)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
