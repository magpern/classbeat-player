#!/bin/sh
# Runs once, when the database is first created (the postgres image's init directory), as the
# postgres user, after 10-roles.sql made the roles. Sets the two login passwords from the copies
# that db-entrypoint.sh made in /run/dbinit (tmpfs, 0400, postgres), then removes them.
# player_auth never logs in and gets none. Later changes: the runbook, "Rotating".
set -eu
for pair in player_owner:player_owner_password player_app:player_app_password; do
  set-role-password.sh "${pair%%:*}" "/run/dbinit/${pair#*:}"
done
rm -f /run/dbinit/player_owner_password /run/dbinit/player_app_password
