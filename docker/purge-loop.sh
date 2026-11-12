#!/bin/sh
# The hourly purge scheduler (issue #95): runs `purge` at minute 17 of every hour, as
# player_owner, through the entrypoint. A failed run is logged and tried again the next hour.
# It holds no state, so a restart loses nothing. PLAYER_PURGE_MINUTE (0-59) moves the minute.
set -eu

minute="${PLAYER_PURGE_MINUTE:-17}"
case "$minute" in
  '' | *[!0-9]*)
    echo "purge-loop: PLAYER_PURGE_MINUTE must be 0-59" >&2
    exit 2
    ;;
esac
if [ "$minute" -gt 59 ]; then
  echo "purge-loop: PLAYER_PURGE_MINUTE must be 0-59" >&2
  exit 2
fi
entry="${PLAYER_PURGE_ENTRYPOINT:-backend-entrypoint.sh}"
once="${PLAYER_PURGE_ONCE:-}" # a test runs one round without waiting

while :; do
  if [ -z "$once" ]; then
    now="$(date +%s)"
    wait=$(((minute * 60 - now % 3600 + 3600) % 3600))
    if [ "$wait" -gt 0 ]; then
      sleep "$wait"
    fi
  fi
  echo "purge-loop: purge starting"
  if "$entry" purge; then
    echo "purge-loop: purge done"
  else
    echo "purge-loop: purge FAILED, trying again next hour" >&2
  fi
  if [ -n "$once" ]; then
    exit 0
  fi
  sleep 1
done
