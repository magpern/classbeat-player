#!/bin/sh
# The db service's entrypoint (issue #95). It runs as root, before the postgres image drops to the
# postgres user (gosu), and that drop also drops the extra group Docker added, so the init script
# (20-passwords.sh, running as postgres) could not read the secret files. So, while still root:
# copy the two role passwords to a tmpfs directory, readable by postgres alone (mode 0400), then
# hand over to the image's own entrypoint. The copies exist only in memory and are removed by the
# init script once it has used them. postgres_password needs no copy: the image reads
# POSTGRES_PASSWORD_FILE as root. The secret files themselves are readable by root only on the
# db side, because this service mounts them without any group.
set -eu

dir=/run/dbinit
# Only at the first start (an empty data directory): later starts skip the init scripts.
if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then
  for name in player_owner_password player_app_password; do
    install -m 0400 -o postgres -g postgres "/run/secrets/$name" "$dir/$name"
  done
fi
exec docker-entrypoint.sh "$@"
