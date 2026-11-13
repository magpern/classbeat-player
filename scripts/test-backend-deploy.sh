#!/usr/bin/env bash
# Checks the backend deploy files (issue #95) with placeholder secrets. No network, no real
# account, nothing is started: `docker compose config` only reads the files.
#   1. the compose file is valid
#   2. no secret value is in the file; every secret is a file mounted only where it is needed
#   3. the app connects as player_app, migrations and the purge as player_owner
#   4. one backend process, no published port but loopback, an internal database network
#   5. the purge scheduler runs the purge entrypoint
# Without Docker the compose part is skipped locally and fails when CI=true.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
ok() { echo "ok: $1"; }
bad() {
  echo "FAIL: $1"
  fail=1
}

# --- placeholder secrets and settings ---------------------------------------------------------
mkdir "$tmp/secrets"
for name in postgres_password player_owner_password player_app_password player_smtp_password; do
  echo "PLACEHOLDER-$name" >"$tmp/secrets/$name"
  chmod 0440 "$tmp/secrets/$name"
done
# The documented defaults (.env.example), with the secrets directory filled in.
sed -e "s|^PLAYER_SECRETS_DIR=.*|PLAYER_SECRETS_DIR=$tmp/secrets|" "$root/docker/.env.example" >"$tmp/env"

# --- 1 and 2: compose ------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f "$root/docker/compose.backend.yml" --env-file "$tmp/env")
  if "${compose[@]}" config >"$tmp/config.yml" 2>"$tmp/config.err"; then
    ok "docker compose config succeeds with placeholder secrets"
  else
    bad "docker compose config failed: $(head -c 400 "$tmp/config.err")"
  fi
  "${compose[@]}" config --format json >"$tmp/config.json" 2>/dev/null || true

  # A required setting left out must stop the file, not become an empty value: each on its own.
  for required in PLAYER_SECRETS_DIR PLAYER_SITE_ORIGIN; do
    grep -v "^$required=" "$tmp/env" >"$tmp/env.without"
    if docker compose -f "$root/docker/compose.backend.yml" --env-file "$tmp/env.without" config >/dev/null 2>&1; then
      bad "compose accepted a missing $required"
    else
      ok "compose refuses a missing $required"
    fi
  done

  # The backend's own loaders accept the environment compose gives it, without mail (the
  # documented defaults) and with mail: the real Settings and SmtpSettings read it.
  load_env() { # load_env <env file> <without-mail|with-mail>
    docker compose -f "$root/docker/compose.backend.yml" --env-file "$1" config --format json >"$tmp/$2.json" 2>/dev/null
    python3 - "$root" "$tmp/$2.json" "$2" <<'PY' || fail=1
import json
import sys

sys.path.insert(0, sys.argv[1] + "/backend/src")
from player_backend.settings import Settings
from player_backend.smtp_settings import SmtpSettings

env = json.load(open(sys.argv[2], encoding="utf-8"))["services"]["backend"]["environment"]
# Compose leaves out a name with no value; the entrypoint adds the database address.
env = {key: value for key, value in env.items() if value is not None}
env["PLAYER_DATABASE_URL"] = "postgresql://player_app:x@db/player"
settings = Settings.from_env(env)
smtp = SmtpSettings.from_env(env)
want_mail = sys.argv[3] == "with-mail"
if (smtp is not None) != want_mail:
    sys.exit(f"FAIL: {sys.argv[3]}: mail is {'on' if smtp else 'off'}")
if settings.site_origin != "https://player.example.com":
    sys.exit("FAIL: the site origin did not arrive")
print(f"ok: the backend's loaders accept the compose environment ({sys.argv[3]})")
PY
  }
  load_env "$tmp/env" without-mail
  printf 'smtp-pw\n' >"$tmp/smtp-pw"
  {
    cat "$tmp/env"
    echo "PLAYER_SMTP_HOST=smtp.example.com"
    echo "PLAYER_SMTP_FROM=login@player.example.com"
    echo "PLAYER_SMTP_TLS=starttls"
    echo "PLAYER_SMTP_USER=login@player.example.com"
    echo "PLAYER_SMTP_PASSWORD_FILE=$tmp/smtp-pw"
  } >"$tmp/env.mail"
  load_env "$tmp/env.mail" with-mail

  if ! python3 -I - "$tmp/config.json" <<'PY'; then
import json
import re
import sys

config = json.load(open(sys.argv[1], encoding="utf-8"))
services = config["services"]
problems: list[str] = []


def need(condition: bool, text: str) -> None:
    if not condition:
        problems.append(text)


secret_name = re.compile(r"(PASSWORD|SECRET|TOKEN|KEY)$")
for name, service in services.items():
    for key, value in (service.get("environment") or {}).items():
        value = "" if value is None else str(value)
        need("PLACEHOLDER" not in value, f"{name}: {key} holds a secret value")
        # A setting that names a secret may only name a file, never hold one.
        if secret_name.search(key) and not key.endswith("_FILE"):
            need(value == "", f"{name}: {key} looks like a secret value")
        if key == "PLAYER_SMTP_PASSWORD":
            problems.append(f"{name}: PLAYER_SMTP_PASSWORD is refused by the backend")
        if "://" in value and "@" in value:
            problems.append(f"{name}: {key} looks like an address with credentials")

# Every secret is a file.
for name, secret in config.get("secrets", {}).items():
    need("file" in secret and "environment" not in secret, f"secret {name} is not a file")


def mounted(service: str) -> set[str]:
    return {s["source"] if isinstance(s, dict) else s for s in services[service].get("secrets", [])}


need(mounted("backend") == {"player_app_password", "player_smtp_password"}, "backend secrets")
need(mounted("migrate") == {"player_owner_password"}, "migrate secrets")
need(mounted("purge") == {"player_owner_password"}, "purge secrets")
need(
    mounted("db") == {"postgres_password", "player_owner_password", "player_app_password"},
    "db secrets",
)

# The server runs as the app role (the entrypoint's `app` mode), the rest as the owner.
need(services["backend"]["command"] == ["app"], "backend command is not `app`")
need(services["migrate"]["command"] == ["migrate"], "migrate command is not `migrate`")
need(services["purge"]["entrypoint"] == ["purge-loop.sh"], "purge is not the scheduler")
need(services["purge"].get("ports") in (None, []), "purge publishes a port")

# One backend process.
backend = services["backend"]
need(
    (backend.get("deploy") or {}).get("replicas", 1) == 1 and "scale" not in backend,
    "backend is scaled",
)
need("--workers" not in json.dumps(backend), "backend has --workers")

# Ports: only the backend, only on loopback. The database has none and an internal network.
for name, service in services.items():
    if name != "backend":
        need(not service.get("ports"), f"{name} publishes a port")
for port in backend.get("ports", []):
    need(port.get("host_ip") == "127.0.0.1", "backend port is not on loopback")
need(config["networks"]["data"].get("internal") is True, "data network is not internal")
need(set(services["db"]["networks"]) == {"data"}, "db is not only on the internal network")
need(set(services["purge"]["networks"]) == {"data"}, "purge is not only on the internal network")

# The database starts as root and hands the init script its own copies (db-entrypoint.sh).
db = services["db"]
need(db["entrypoint"] == ["/bin/sh", "/usr/local/bin/db-entrypoint.sh"], "db entrypoint")
need(not db.get("user"), "db must start as root (the entrypoint reads the secrets)")
need("group_add" not in db, "db gets no extra group: it reads its secrets as root")
need(any(t.startswith("/run/dbinit:") for t in db.get("tmpfs", [])), "no /run/dbinit tmpfs")

# Hardening that the secret files' modes rely on.
for name in ("backend", "migrate", "purge"):
    service = services[name]
    need(str(service.get("user")) == "10001:10001", f"{name} does not run as 10001")
    need(service.get("read_only") is True, f"{name} is not read-only")
    need("10010" in [str(g) for g in service.get("group_add", [])], f"{name}: no group 10010")

if problems:
    print("\n".join("FAIL: " + p for p in problems))
    sys.exit(1)
print("ok: compose structure (secrets as files, roles, one process, ports, networks)")
PY
    fail=1
  fi
elif [ "${CI:-}" = "true" ]; then
  bad "docker compose is required in CI"
else
  echo "skip: docker compose not available, compose checks not run"
fi

# --- no secret value committed or built in ----------------------------------------------------
if grep -Eiv '^\s*#' "$root/docker/backend.Dockerfile" | grep -Eiq '(password|secret|token)'; then
  bad "backend.Dockerfile mentions a secret outside a comment"
else
  ok "the image holds no secret"
fi
if grep -Eq '^[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)=.+' "$root/docker/.env.example"; then
  bad ".env.example gives a value to a secret-like setting"
else
  ok ".env.example holds no secret value"
fi
for name in PLAYER_SITE_ORIGIN PLAYER_BACKEND_ORIGIN PLAYER_TRUSTED_PROXIES PLAYER_SECRETS_DIR; do
  if grep -q "^$name=" "$root/docker/.env.example"; then
    ok ".env.example has $name"
  else
    bad ".env.example lacks $name"
  fi
done

# --- the live WebSocket in the image (issue #185) ----------------------------------------------
# The size cap equals the app's own limit, read from the code, not typed twice.
want_cap="$(python3 -I -c '
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r"^MESSAGE_MAX_BYTES: Final = (\d+(?: \* \d+)*)$", text, re.M)
print(eval(match.group(1), {"__builtins__": {}}) if match else "")
' "$root/backend/src/player_backend/live_limit_policy.py")"
if [ -z "$want_cap" ]; then
  bad "MESSAGE_MAX_BYTES not found in live_limit_policy.py"
elif grep -Eq -- "--ws-max-size $want_cap( |\\|\$)" "$root/docker/backend-entrypoint.sh" \
  && grep -Eq -- '--ws websockets( |\\|$)' "$root/docker/backend-entrypoint.sh"; then
  ok "the entrypoint caps WebSocket messages at the app limit ($want_cap) with --ws websockets"
else
  bad "the entrypoint lacks --ws websockets or --ws-max-size $want_cap"
fi
if grep -Eq '^COPY schema/live/v1 schema/live/v1$' "$root/docker/backend.Dockerfile"; then
  ok "the Dockerfile copies schema/live/v1"
else
  bad "the Dockerfile does not copy schema/live/v1"
fi
# The companion page's build stage (issue #277): pinned Node, and only the files it reads.
if ! grep -Eq '^COPY --from=web /web/dist/control web/dist/control$' "$root/docker/backend.Dockerfile"; then
  bad "the Dockerfile does not copy web/dist/control from the web stage"
elif ! grep -Eq '^FROM node:[0-9]+[^ ]*@sha256:[0-9a-f]{64} AS web$' "$root/docker/backend.Dockerfile"; then
  bad "the Dockerfile's web stage is not a pinned Node image"
else
  ok "the Dockerfile builds the companion page in a pinned Node stage and copies only web/dist/control"
fi
for allowed in web/package.json web/package-lock.json web/build.mjs web/src; do
  if ! grep -Fxq "!$allowed" "$root/docker/backend.Dockerfile.dockerignore"; then
    bad "backend.Dockerfile.dockerignore does not allow $allowed"
  fi
done
if grep -Eq '^!web/?(\*)?$|^!web/(dist|test)' "$root/docker/backend.Dockerfile.dockerignore"; then
  bad "backend.Dockerfile.dockerignore admits more of web/ than the build reads"
fi
if grep -Eq '^!schema/live/v1$' "$root/docker/backend.Dockerfile.dockerignore"; then
  ok "the Dockerfile's dockerignore lets schema/live/v1 into the build"
else
  bad "backend.Dockerfile.dockerignore does not allow schema/live/v1"
fi
# The generated site API models (issue #287): copied to where the backend loads them from.
if grep -Eq '^COPY schema/generated/python schema/generated/python$' "$root/docker/backend.Dockerfile"; then
  ok "the Dockerfile copies schema/generated/python"
else
  bad "the Dockerfile does not copy schema/generated/python"
fi
if grep -Eq '^!schema/generated/python$' "$root/docker/backend.Dockerfile.dockerignore"; then
  ok "the Dockerfile's dockerignore lets schema/generated/python into the build"
else
  bad "backend.Dockerfile.dockerignore does not allow schema/generated/python"
fi
if grep -Eq '^!schema/generated/?(\*)?$' "$root/docker/backend.Dockerfile.dockerignore"; then
  bad "backend.Dockerfile.dockerignore admits more of schema/generated than python/"
fi
# The built image holds the schemas where the backend reads them, and the backend loads them.
# Needs a Docker daemon and the network an image build already uses (base images, PyPI, npm).
if docker info >/dev/null 2>&1; then
  image="player-backend-test:$$"
  if docker build -q -f "$root/docker/backend.Dockerfile" -t "$image" "$root" >"$tmp/build.log" 2>&1; then
    if docker run --rm --entrypoint python "$image" -I -c '
from player_backend.live import schemas
assert (schemas.SCHEMA_DIR / "routing.json").is_file(), schemas.SCHEMA_DIR
assert schemas.routes(), "no routes"
assert schemas.valid("hello.schema.json", {}) in (True, False)
' >"$tmp/run.log" 2>&1; then
      ok "the image has schema/live/v1/routing.json where the backend reads it"
    else
      bad "the image cannot load the live schemas: $(head -c 400 "$tmp/run.log")"
    fi
    # The generated models (issue #287): present where the backend's GENERATED_DIR resolves.
    if docker run --rm --entrypoint python "$image" -I -c '
from pathlib import Path

generated = Path("/srv/classbeat-player/schema/generated/python")
assert (generated / "site_api_me.py").is_file(), sorted(p.name for p in generated.glob("*"))
' >"$tmp/run.log" 2>&1; then
      ok "the image has schema/generated/python/site_api_me.py where the backend loads it"
    else
      bad "the image lacks the generated models: $(head -c 400 "$tmp/run.log")"
    fi
    # The companion page (issue #277): the image holds the built page where the backend reads it,
    # and GET /control answers 200 with the /control headers. The app is called as an ASGI
    # application (no lifespan, so no database and no socket). GET, not HEAD: HEAD is a 405.
    if docker run --rm --entrypoint python \
      -e PLAYER_DATABASE_URL=postgresql://player_app:x@db/player \
      -e PLAYER_SITE_ORIGIN=https://player.example.com \
      "$image" -I -c '
import asyncio

from player_backend.app import create_app
from player_backend.control_page import CONTROL_DIR
from player_backend.settings import Settings

assert str(CONTROL_DIR) == "/srv/classbeat-player/web/dist/control", CONTROL_DIR
assert (CONTROL_DIR / "index.html").is_file(), "no built page"
app = create_app(Settings.from_env(), live_recheck=None)
sent = []


async def receive():
    return {"type": "http.request", "body": b"", "more_body": False}


async def send(message):
    sent.append(message)


scope = {
    "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
    "scheme": "http", "path": "/control", "raw_path": b"/control", "query_string": b"",
    "headers": [(b"host", b"player.example.com")], "client": ("127.0.0.1", 1),
    "server": ("player.example.com", 80), "root_path": "",
}
asyncio.run(app(scope, receive, send))
start = next(m for m in sent if m["type"] == "http.response.start")
headers = {k.decode().lower(): v.decode() for k, v in start["headers"]}
body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
assert start["status"] == 200, start["status"]
assert headers["content-type"].startswith("text/html"), headers["content-type"]
assert b"<html" in body.lower(), "not the page"
csp = headers["content-security-policy"]
assert "default-src '"'"'none'"'"'" in csp and "frame-ancestors '"'"'none'"'"'" in csp, csp
assert headers["referrer-policy"] == "no-referrer"
assert headers["x-content-type-options"] == "nosniff"
assert headers["x-frame-options"] == "DENY"
assert headers["cache-control"] == "no-store"
' >"$tmp/control.log" 2>&1; then
      ok "the image serves GET /control: 200 with the CSP, no-referrer, nosniff, DENY and no-store"
    else
      bad "the image does not serve /control as expected: $(tail -c 400 "$tmp/control.log")"
    fi
  else
    bad "the backend image did not build: $(tail -c 400 "$tmp/build.log")"
  fi
  docker rmi -f "$image" >/dev/null 2>&1 || true
elif [ "${CI:-}" = "true" ]; then
  bad "a Docker daemon is required in CI to build the backend image"
else
  echo "skip: no Docker daemon, the image content check was not run"
fi

# --- the entrypoint's roles: a stand-in `python` shows the environment it would get -------------
mkdir "$tmp/bin" "$tmp/mount"
cat >"$tmp/bin/python" <<'EOF'
#!/bin/sh
# The entrypoint's own `python -I -c` runs for real; anything else only reports.
if [ "${1:-}" = "-I" ]; then exec python3 "$@"; fi
echo "ARGS=$*"
echo "APP=${PLAYER_DATABASE_URL-unset}"
echo "OWNER=${PLAYER_DATABASE_OWNER_URL-unset}"
EOF
cat >"$tmp/bin/uvicorn" <<'EOF'
#!/bin/sh
echo "ARGS=uvicorn $*"
echo "APP=${PLAYER_DATABASE_URL-unset}"
echo "OWNER=${PLAYER_DATABASE_OWNER_URL-unset}"
EOF
chmod +x "$tmp/bin/python" "$tmp/bin/uvicorn"
printf 'p@ss/w:rd#1\n' >"$tmp/mount/player_app_password"
printf 'own er%%pw\n' >"$tmp/mount/player_owner_password"

run_entry() {
  PATH="$tmp/bin:$PATH" PLAYER_SECRETS_MOUNT="$tmp/mount" PLAYER_DB_HOST=db PLAYER_DB_NAME=player \
    PLAYER_DATABASE_URL=stale PLAYER_DATABASE_OWNER_URL=stale \
    sh "$root/docker/backend-entrypoint.sh" "$@"
}
check_out() { # check_out <name> <expected text> <output>
  if printf '%s\n' "$3" | grep -qxF -- "$2"; then ok "$1"; else bad "$1 (wanted: $2; got: $3)"; fi
}

out="$(run_entry app)"
check_out "app connects as player_app, password escaped" \
  "APP=postgresql://player_app:p%40ss%2Fw%3Ard%231@db/player" "$out"
check_out "app has no owner address" "OWNER=unset" "$out"
check_out "app is one uvicorn process" \
  "ARGS=uvicorn --factory player_backend.app:app_from_env --host 0.0.0.0 --port 8000 --no-access-log --no-proxy-headers --ws websockets --ws-max-size 16384" "$out"
out="$(run_entry purge)"
check_out "purge connects as player_owner" "OWNER=postgresql://player_owner:own%20er%25pw@db/player" "$out"
check_out "purge has no app address" "APP=unset" "$out"
check_out "purge runs the admin purge command" "ARGS=-m player_backend.admin purge" "$out"
out="$(run_entry migrate)"
check_out "migrate connects as player_owner" "OWNER=postgresql://player_owner:own%20er%25pw@db/player" "$out"
out="$(run_entry admin allowlist add a@b.c)"
check_out "admin runs as player_owner" "ARGS=-m player_backend.admin allowlist add a@b.c" "$out"
if run_entry nonsense >/dev/null 2>&1; then bad "an unknown mode started"; else ok "an unknown mode is refused"; fi
# One password on both sides (the entrypoint's and psql's, in set-role-password.sh), CRLF or LF.
printf 'crlf-pw\r\n' >"$tmp/mount/player_app_password"
out="$(run_entry app)"
check_out "a CRLF password file gives the same password as LF" "APP=postgresql://player_app:crlf-pw@db/player" "$out"
rule="1{s/\\r\$//;p;q}"
if [ "$(sed -n "$rule" "$tmp/mount/player_app_password")" = "crlf-pw" ] \
  && grep -qF -- "sed -n '1{s/\\\\r\\$//;p;q}'" "$root/docker/postgres/set-role-password.sh"; then
  ok "set-role-password.sh strips CRLF by the same rule"
else
  bad "set-role-password.sh does not strip CRLF like the entrypoint"
fi
if sh "$root/docker/postgres/set-role-password.sh" postgres /dev/null >/dev/null 2>&1; then
  bad "set-role-password.sh accepted another role"
else
  ok "set-role-password.sh refuses another role"
fi
: >"$tmp/mount/player_app_password"
if run_entry app >/dev/null 2>&1; then bad "an empty password file started the app"; else ok "an empty password file is refused"; fi

# A real, readable password file whose NAME holds a newline must be refused by the name guard
# (not by a missing file), and psql must never run. A stub psql leaves a marker if it does.
nlfile="$tmp/pw"$'\n'"file"
printf 'good-pw\n' >"$nlfile"
cat >"$tmp/bin/psql" <<EOF
#!/bin/sh
touch "$tmp/psql-ran"
EOF
chmod +x "$tmp/bin/psql"
rc=0
err="$(PATH="$tmp/bin:$PATH" POSTGRES_USER=u POSTGRES_DB=d sh "$root/docker/postgres/set-role-password.sh" player_app "$nlfile" 2>&1 >/dev/null)" || rc=$?
if [ "$rc" -eq 2 ] && [ "$err" = "set-role-password: bad file name" ] && [ ! -e "$tmp/psql-ran" ]; then
  ok "set-role-password.sh refuses a file name with a newline, without running psql"
else
  bad "set-role-password.sh did not refuse a file name with a newline (exit $rc, stderr: $err)"
fi

# --- the db files: healthcheck over TCP, the data directory from $PGDATA -----------------------
if grep -Eq 'pg_isready .*-h 127\.0\.0\.1' "$root/docker/compose.backend.yml"; then
  ok "the db healthcheck checks over TCP (not the init server's socket)"
else
  bad "the db healthcheck does not use -h 127.0.0.1"
fi
# shellcheck disable=SC2016 # the text searched for is literal shell source
if grep -v '^#' "$root/docker/postgres/db-entrypoint.sh" | grep -q '\${PGDATA:-/var/lib/postgresql/data}' \
  && ! grep -v '^#' "$root/docker/postgres/db-entrypoint.sh" | sed 's|\${PGDATA:-/var/lib/postgresql/data}||' | grep -q '/var/lib/postgresql/data'; then
  ok "db-entrypoint.sh takes the data directory from PGDATA, with the image default"
else
  bad "db-entrypoint.sh hard-codes the data directory"
fi

# --- the scheduler -----------------------------------------------------------------------------
cat >"$tmp/entry" <<'EOF'
#!/bin/sh
echo "entry called: $*"
EOF
chmod +x "$tmp/entry"
out="$(PLAYER_PURGE_ONCE=1 PLAYER_PURGE_ENTRYPOINT="$tmp/entry" sh "$root/docker/purge-loop.sh")"
check_out "the scheduler runs the purge entrypoint" "entry called: purge" "$out"
printf '#!/bin/sh\nexit 1\n' >"$tmp/entry"
if out="$(PLAYER_PURGE_ONCE=1 PLAYER_PURGE_ENTRYPOINT="$tmp/entry" sh "$root/docker/purge-loop.sh" 2>&1)"; then
  check_out "a failed purge is logged and not fatal" "purge-loop: purge FAILED, trying again next hour" "$out"
else
  bad "a failed purge stopped the scheduler"
fi
if PLAYER_PURGE_MINUTE=60 sh "$root/docker/purge-loop.sh" >/dev/null 2>&1; then
  bad "minute 60 accepted"
else
  ok "minute 60 refused"
fi

if [ "$fail" -ne 0 ]; then
  echo "test-backend-deploy: FAILED"
  exit 1
fi
echo "test-backend-deploy: ok"
