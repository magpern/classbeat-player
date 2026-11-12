#!/bin/sh
# Runs once, when the database is first created (the postgres image's init directory), after
# 10-roles.sql made the roles. Sets the two login passwords from the mounted secret files. The
# files are read by psql itself (backtick), so no password is ever in an argument. player_auth
# never logs in and gets none. Later changes: docs/runbooks/backend-deploy.md, "Rotating".
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\set owner_pw `cat /run/secrets/player_owner_password`
\set app_pw `cat /run/secrets/player_app_password`
ALTER ROLE player_owner PASSWORD :'owner_pw';
ALTER ROLE player_app PASSWORD :'app_pw';
SQL
