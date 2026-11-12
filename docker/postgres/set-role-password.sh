#!/bin/sh
# set-role-password.sh <player_owner|player_app> <password file>
# Sets the role's login password from the first line of the file. psql reads the file itself
# (backtick), so the password is never an argument. The first line without its line break (LF or
# CRLF) is the password, the same rule as docker/backend-entrypoint.sh. Used by 20-passwords.sh at
# the first start and by the runbook's rotation step (as root, inside the db container).
set -eu

role="${1:-}"
file="${2:-}"
case "$role" in
  player_owner | player_app) ;;
  *)
    echo "set-role-password: role must be player_owner or player_app" >&2
    exit 2
    ;;
esac
case "$file" in
  '' | *"'"* | *'`'*)
    echo "set-role-password: bad file name" >&2
    exit 2
    ;;
esac
first="$(sed -n '1{s/\r$//;p;q}' "$file")"
if [ -z "$first" ]; then
  echo "set-role-password: empty password file" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
\\set pw \`sed -n '1{s/\\r\$//;p;q}' '$file'\`
ALTER ROLE $role PASSWORD :'pw';
SQL
