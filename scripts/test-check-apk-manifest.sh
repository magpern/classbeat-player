#!/usr/bin/env bash
# Tests check-apk-manifest.sh on fake `aapt2 dump xmltree` text, one mutation per check (#629):
# each check is shown to fail when its attribute is wrong.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0
dump() { # dump <application attribute lines...>
  printf 'N: android=http://schemas.android.com/apk/res/android\n  E: manifest (line=2)\n'
  printf '    E: uses-sdk (line=4)\n      A: http://schemas.android.com/apk/res/android:minSdkVersion(0x0101020c)=28\n'
  printf '    E: application (line=9)\n'
  for a in "$@"; do printf '      A: http://schemas.android.com/apk/res/android:%s\n' "$a"; done
  printf '      E: activity (line=20)\n        A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true\n'
}
expect() { # expect <ok|fail> <name> <mode> <dump text>
  local rc=0
  printf '%s\n' "$4" | bash "$here/check-apk-manifest.sh" "$3" >/dev/null 2>&1 || rc=$?
  if { [ "$1" = ok ] && [ "$rc" -eq 0 ]; } || { [ "$1" = fail ] && [ "$rc" -eq 1 ]; }; then
    echo "ok   $2"
  else
    echo "FAIL $2 (exit $rc)" >&2
    fail=1
  fi
}
DBG='debuggable(0x0101000f)=true'
NODBG='debuggable(0x0101000f)=false'
BAK='allowBackup(0x01010280)=false'

expect ok "debug build: debuggable, backup off" debug "$(dump "$DBG" "$BAK")"
expect ok "release build: not debuggable, backup off" release "$(dump "$NODBG" "$BAK")"
expect ok "release build: debuggable absent counts as off" release "$(dump "$BAK")"
expect ok "raw boolean values are read" debug "$(dump 'debuggable(0x0101000f)=(type 0x12)0xffffffff' 'allowBackup(0x01010280)=(type 0x12)0x0')"
# One mutation per check.
expect fail "mutation: a debug build that is not debuggable" debug "$(dump "$NODBG" "$BAK")"
expect fail "mutation: a debug build with debuggable missing" debug "$(dump "$BAK")"
expect fail "mutation: a release build that is debuggable" release "$(dump "$DBG" "$BAK")"
expect fail "mutation: backup on, release" release "$(dump "$NODBG" 'allowBackup(0x01010280)=true')"
expect fail "mutation: backup on, debug" debug "$(dump "$DBG" 'allowBackup(0x01010280)=true')"
expect fail "mutation: backup attribute missing (the default is on)" release "$(dump "$NODBG")"
expect fail "mutation: an unreadable value is not accepted" release "$(dump "$NODBG" 'allowBackup(0x01010280)=maybe')"
# The dump's child <activity> carries debuggable=true; it must not make the application debuggable.
expect ok "debuggable on a child element does not count" release "$(dump "$NODBG" "$BAK")"
expect fail "no application element" release "N: android=x"

exit "$fail"
