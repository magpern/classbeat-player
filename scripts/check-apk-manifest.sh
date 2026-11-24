#!/usr/bin/env bash
# Checks the <application> element of a BUILT APK's manifest (issue #629, ADR 0011 section 9).
#   check-apk-manifest.sh debug   <apk>   the debug build is debuggable (web view debugging on)
#   check-apk-manifest.sh release <apk>   a release-configured build is not debuggable
# Both also need backup off (android:allowBackup="false" must be present: the default is on).
# The manifest is read from the APK with aapt2 ($AAPT2, or aapt2 on the PATH). Without <apk> the
# `aapt2 dump xmltree` text is read from stdin, which is how scripts/test-check-apk-manifest.sh
# feeds it. Reads only; no device, no network.
set -euo pipefail

want="${1-}"
case "$want" in debug | release) ;; *)
  echo "usage: $0 debug|release [apk]" >&2
  exit 2
  ;;
esac

if [ -n "${2-}" ]; then
  dump="$("${AAPT2:-aapt2}" dump xmltree --file AndroidManifest.xml "$2")"
else
  dump="$(cat)"
fi

# The attributes sit right under the `E: application` line, before its first child element.
app="$(printf '%s\n' "$dump" | awk '
  /^[[:space:]]*E: / { inapp = ($2 == "application"); next }
  inapp && /^[[:space:]]*A: / { print }
')"
[ -n "$app" ] || { echo "no <application> attributes found in the manifest" >&2; exit 1; }

# attr <name>: true, false, absent or unreadable:<text>. aapt2 prints a boolean as true/false or
# as 0xffffffff/0x0, with or without a "(type 0x12)" prefix.
attr() {
  local v
  v="$(printf '%s\n' "$app" | sed -n "s#^[[:space:]]*A: [^ ]*[:/]$1(0x[0-9a-fA-F]*)=\\(.*\\)\$#\\1#p" | head -n 1)"
  v="${v#(type 0x12)}"
  v="${v%% *}"
  case "$v" in
    true | 0xffffffff) echo true ;;
    false | 0x0 | 0x00000000) echo false ;;
    "") echo absent ;;
    *) echo "unreadable:$v" ;;
  esac
}

debuggable="$(attr debuggable)"
backup="$(attr allowBackup)"
fail=0
case "$want:$debuggable" in
  debug:true | release:false | release:absent) ;;
  *)
    echo "a $want build must not have debuggable=$debuggable" >&2
    fail=1
    ;;
esac
if [ "$backup" != false ]; then
  echo "backup must be off (allowBackup=$backup)" >&2
  fail=1
fi
[ "$fail" -eq 0 ] && echo "ok: $want build, debuggable=$debuggable, allowBackup=$backup"
exit "$fail"
