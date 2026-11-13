#!/bin/sh
# Starts one backend process in one of four modes (issue #95, ADR 0002 sections 9 and 11):
#   app      the server, as the role player_app
#   migrate  the migrations, as player_owner (once, before the server)
#   purge    `python -m player_backend.admin purge` once, as player_owner
#   admin    any other operator command (`admin allowlist add <email>`), as player_owner
# The backend reads its database address from one variable that holds the password, but no secret
# may sit in a compose value. So the password is read here from a mounted file and the address is
# put in the environment of the one process that needs it, never in an argument or a file.
set -eu

DB_HOST="${PLAYER_DB_HOST:-db}"
DB_NAME="${PLAYER_DB_NAME:-player}"
SECRETS="${PLAYER_SECRETS_MOUNT:-/run/secrets}"

# url <role> <password file>: postgresql://role:password@host/name, the password escaped.
url() {
  python -I -c '
import sys
from urllib.parse import quote
with open(sys.argv[2], encoding="utf-8") as handle:
    # The first line, without its line break (LF or CRLF): the same rule as
    # docker/postgres/set-role-password.sh, so both sides see one password.
    password = handle.readline().rstrip("\n").removesuffix("\r")
if not password:
    sys.exit("empty password file: " + sys.argv[2])
print("postgresql://%s:%s@%s/%s" % (sys.argv[1], quote(password, safe=""), sys.argv[3], sys.argv[4]))
' "$1" "$2" "$DB_HOST" "$DB_NAME"
}

mode="${1:-app}"
[ "$#" -gt 0 ] && shift

case "$mode" in
  app)
    PLAYER_DATABASE_URL="$(url player_app "$SECRETS/player_app_password")"
    export PLAYER_DATABASE_URL
    unset PLAYER_DATABASE_OWNER_URL
    # One process, on purpose: live sessions keep their state in the memory of one process
    # (plan section 5). Never add --workers or run a second replica. The client address comes
    # from X-Forwarded-For only for PLAYER_TRUSTED_PROXIES, so uvicorn's own handling is off.
    # The live WebSocket: `--ws websockets` is pinned (closing a peer that does not read relies
    # on its send waiting for the peer), and `--ws-max-size` is MESSAGE_MAX_BYTES of
    # live_limit_policy.py (16 KiB), so uvicorn never buffers more than the app would accept.
    # scripts/test-backend-deploy.sh keeps the number equal to the code.
    exec uvicorn --factory player_backend.app:app_from_env \
      --host 0.0.0.0 --port 8000 --no-access-log --no-proxy-headers \
      --ws websockets --ws-max-size 16384 "$@"
    ;;
  migrate | purge | admin)
    PLAYER_DATABASE_OWNER_URL="$(url player_owner "$SECRETS/player_owner_password")"
    export PLAYER_DATABASE_OWNER_URL
    unset PLAYER_DATABASE_URL
    case "$mode" in
      migrate) exec python -m player_backend.db.migrate "$@" ;;
      purge) exec python -m player_backend.admin purge "$@" ;;
      *) exec python -m player_backend.admin "$@" ;;
    esac
    ;;
  *)
    echo "backend-entrypoint: unknown mode: $mode (app, migrate, purge, admin)" >&2
    exit 2
    ;;
esac
