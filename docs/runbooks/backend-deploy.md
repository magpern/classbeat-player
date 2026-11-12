# Runbook: run the backend on one server

Files: `docker/compose.backend.yml`, `docker/.env.example`, `docker/backend.Dockerfile`,
`docker/backend-entrypoint.sh`, `docker/purge-loop.sh`, `docker/postgres/20-passwords.sh`.
Design: [ADR 0002](../adr/0002-accounts-sign-in-pairing-and-tokens.md), sections 9 and 11. The
agents wrote these files and never run them against a server. **Every step marked (owner) is the
owner's**: the server, the domain, DNS, TLS and the mail service. Nothing here is deployed by an
agent.

All commands run on the server, from the repository root (a checkout of the release to run), and
use the compose file as `docker compose -f docker/compose.backend.yml ...`, written `compose` below.

## What runs

| Service | Runs as | Does |
|---|---|---|
| `db` | `postgres` image, PostgreSQL 17 | The database, on an internal network with no route out and no published port |
| `migrate` | role `player_owner` | Applies the migrations, then exits. The server starts only after it succeeded |
| `backend` | role `player_app` | The web server: one process, published on `127.0.0.1:8000` only |
| `purge` | role `player_owner` | The hourly purge (see "The purge"). Never serves a request |

The server is **one process** and must stay one: live sessions keep their state in the memory of one
process (plan, section 5). Never add `--workers`, `deploy.replicas` or `--scale backend=2`; a CI
test fails on it.

## Settings

All settings are in `docker/.env` (copy `docker/.env.example`; it is never committed). Passwords are
files, not settings.

| Setting | Needed | Meaning |
|---|---|---|
| `PLAYER_SECRETS_DIR` | yes | The directory with the four secret files below |
| `PLAYER_SITE_ORIGIN` | yes | The website's origin, HTTPS, no path. It is what `Origin` must equal and the start of the link in a sign-in mail. The domain is the owner's |
| `PLAYER_BACKEND_ORIGIN` | no, not read by the backend | The backend's address as the desktop app reaches it. It is the app's setting; kept here so it is set together with the site origin |
| `PLAYER_TRUSTED_PROXIES` | yes, in practice | Addresses or networks whose `X-Forwarded-For` counts. The host's reverse proxy reaches the published port through the `edge` network (`172.31.80.0/24`), so a proxy on the same host shows up as `172.31.80.1`, which is the default in `.env.example`. If empty, every client looks like the proxy and the sign-in limits count everybody as one address |
| `PLAYER_SOURCES` | no | JSON list of the sources that may be linked (ADR 0002, section 7). Empty: none |
| `PLAYER_LOG_LEVEL` | no | `DEBUG`, `INFO` (default), `WARNING`, `ERROR` |
| `PLAYER_BACKEND_PORT` | no | Host port on `127.0.0.1`, default 8000 |
| `PLAYER_DB_NAME` | no | Database name, default `player`. Fixed at the first start |
| `PLAYER_BACKEND_VERSION` | no | Tag of the image the compose file builds, default `local` |
| `PLAYER_PURGE_MINUTE` | no | Minute of the hour for the purge, 0 to 59, default 17 |
| `PLAYER_SMTP_HOST`, `PLAYER_SMTP_TLS`, `PLAYER_SMTP_PORT`, `PLAYER_SMTP_FROM`, `PLAYER_SMTP_USER`, `PLAYER_SMTP_PASSWORD_FILE`, `PLAYER_SMTP_HELO_NAME` | no | Mail (backend README, "Mail"). Without a host every mail is dropped. With one, set `PLAYER_SMTP_FROM`, and `PLAYER_SMTP_USER` together with `PLAYER_SMTP_PASSWORD_FILE=/run/secrets/player_smtp_password` |

### Secrets

Four files in `PLAYER_SECRETS_DIR`, one value each, one line, never in the repository, the image,
`docker/.env` or an environment value:

| File | Read by | Used for |
|---|---|---|
| `postgres_password` | `db` | The database superuser, only for the first start and for your own maintenance |
| `player_owner_password` | `db` (first start), `migrate`, `purge` | The login of role `player_owner` |
| `player_app_password` | `db` (first start), `backend` | The login of role `player_app` |
| `player_smtp_password` | `backend` | The mail server's password. Holds a placeholder line until mail is set up |

Each service mounts only the files in its row. Make them (owner), as root:

```bash
umask 077
install -d -m 0750 -g 10010 /etc/classbeat-player/secrets   # a directory of your choice, outside the repository
cd /etc/classbeat-player/secrets
for f in postgres_password player_owner_password player_app_password; do openssl rand -base64 33 >"$f"; done
echo unused >player_smtp_password                           # replace with the mail password when mail is set up
chgrp 10010 ./*; chmod 0440 ./*
```

The containers run as user 10001 with the extra group 10010, so a file readable by group 10010
(mode 0440) is what the compose file expects. Never make a secret file world-readable.
A password may hold any characters; the entrypoint escapes it.

## First start

1. (owner) A server with Docker and Compose, a domain for `PLAYER_SITE_ORIGIN`, DNS and a reverse
   proxy that terminates TLS and forwards to `http://127.0.0.1:8000`. The proxy must set
   `X-Forwarded-For` to the client's address and replace any value the client sent.
2. Check out the release, create the secret files (above) and `docker/.env`.
3. `compose config` must print the file without an error.
4. `compose up -d --build --wait`. On the very first start `db` creates the database, runs
   `backend/db/init/10-roles.sql` (the three roles) and `docker/postgres/20-passwords.sh` (the two
   logins), then `migrate` applies the migrations and `backend` starts.
5. `compose ps` shows `db` and `backend` healthy, `migrate` exited with 0, `purge` running.
   `curl http://127.0.0.1:8000/healthz` answers `{"status":"ok"}`.
6. Add the first person to the allowlist (below), then sign in on the site.

The database's init scripts run only on an empty data volume. If the first start failed half way,
remove the volume (`compose down -v`, this deletes the data) and start again.

## The allowlist (owner)

Only addresses on the allowlist can sign in (ADR 0002, section 9). The commands run as
`player_owner` in a throwaway container; they refuse any other role.

```bash
compose run --rm migrate admin allowlist add someone@example.com
compose run --rm migrate admin allowlist remove someone@example.com
compose run --rm migrate admin allowlist list
```

An address is trimmed and lower-cased first. Exit status 0 is done, 1 refused or failed, 2 bad input.

## The purge

`auth_purge_expired()` deletes the expired authentication rows (ADR 0002, section 9).
It runs **every hour at minute 17** (`PLAYER_PURGE_MINUTE`) in the `purge` service: a small shell
scheduler (`docker/purge-loop.sh`) that calls `python -m player_backend.admin purge` as
`player_owner`. It was chosen over a systemd timer because it needs nothing on the host, starts with
the stack, and is covered by the same CI test as the rest of the deploy files. It keeps no state;
a failed run is logged and tried again an hour later, and the container restarts with the stack.

```bash
compose logs --since 3h purge                 # "purge-loop: purge done" once an hour
compose run --rm migrate purge                # run it once by hand
```

A missing "done" line for more than two hours, or any "FAILED", is a fault: read the `purge` logs.
The command prints only that it ran, and a database error as its type and SQLSTATE.

## Upgrades

1. Read the release notes for changes to settings; add new ones to `docker/.env`.
2. Back up the database first (below).
3. Check out the new release, then `compose up -d --build --wait`. `migrate` runs before the new
   server starts; each migration runs once, in its own transaction, and a changed applied
   migration is refused (backend README). A failed `migrate` leaves the old server running.
4. `compose ps` and `/healthz` as in "First start". To go back, check out the old release and
   start it; migrations are not reversed, so restore the backup if a migration must be undone.

The server is down for the few seconds the container restarts; there is no second process to take
over, by design.

## Backup (owner)

```bash
compose exec -T db pg_dump -U postgres -Fc player >player-$(date +%F).dump
```

Store the dump encrypted and off the server. The dump holds hashes, never a token or a password.

## Rotating a database password

1. Write the new value to the file in `PLAYER_SECRETS_DIR` (mode as above).
2. Change the role, reading the file as the init script does:
   ```bash
   compose exec db psql -v ON_ERROR_STOP=1 -U postgres -d player <<'SQL'
   \set pw `cat /run/secrets/player_app_password`
   ALTER ROLE player_app PASSWORD :'pw';
   SQL
   ```
   (`player_owner_password` and `ALTER ROLE player_owner` for the other.)
3. `compose up -d --force-recreate backend purge` so they read the file again.

## Checklist of the owner's steps

Server and Docker; domain, DNS and TLS and the reverse proxy; the secret files; `docker/.env`
(`PLAYER_SITE_ORIGIN`, `PLAYER_TRUSTED_PROXIES`, mail); the mail service and its password
(`docs/owner.md`); the first allowlist entry; backups. Agents do none of them.
