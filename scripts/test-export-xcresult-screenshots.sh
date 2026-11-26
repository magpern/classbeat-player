#!/usr/bin/env bash
# Tests export-xcresult-screenshots.sh with a fake `xcrun` (#941): no Xcode, no network.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/bundle.xcresult"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1" >&2; fail=1; fi; }
# The fake writes what FAKE_MODE says into --output-path, like `xcresulttool export attachments`.
cat >"$tmp/bin/xcrun" <<'FAKE'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do [ "$1" = --output-path ] && out="$2"; shift; done
case "$FAKE_MODE" in
  fail) exit 1 ;;
  empty) echo '[]' >"$out/manifest.json" ;;
  some)
    printf 'png1' >"$out/A.png"; printf 'png2' >"$out/B.png"; printf 'secret' >"$out/C.txt"
    cat >"$out/manifest.json" <<'J'
[{"testIdentifier":"T/a","attachments":[
 {"exportedFileName":"A.png","suggestedHumanReadableName":"ios-pair-done_0_UUID.png"},
 {"exportedFileName":"B.png","suggestedHumanReadableName":"ios-pair-refused_1_UUID.png"},
 {"exportedFileName":"C.txt","suggestedHumanReadableName":"notes.txt"}]}]
J
    ;;
esac
FAKE
chmod +x "$tmp/bin/xcrun"
run() { FAKE_MODE="$1" PATH="$tmp/bin:$PATH" bash "$here/export-xcresult-screenshots.sh" "${3:-$tmp/bundle.xcresult}" "$2" >/dev/null 2>&1; }

rc=0; run some "$tmp/o1" || rc=$?
check "exports the ios-* PNGs and exits 0" '[ "$rc" -eq 0 ] && [ -f "$tmp/o1/ios-pair-done_0_UUID.png" ] && [ -f "$tmp/o1/ios-pair-refused_1_UUID.png" ]'
check "copies nothing that is not an ios-* attachment" '[ "$(ls "$tmp/o1" | wc -l)" -eq 2 ]'
rc=0; run empty "$tmp/o2" || rc=$?
check "zero attachments exits 0 with an empty dir" '[ "$rc" -eq 0 ] && [ -d "$tmp/o2" ] && [ -z "$(ls "$tmp/o2")" ]'
rc=0; run fail "$tmp/o3" || rc=$?
check "a failed export exits 0" '[ "$rc" -eq 0 ]'
rc=0; run some "$tmp/o4" "$tmp/missing.xcresult" || rc=$?
check "a missing bundle exits 0" '[ "$rc" -eq 0 ] && [ -z "$(ls "$tmp/o4")" ]'
exit "$fail"
