#!/usr/bin/env bash
# Tests export-xcresult-screenshots.sh with a fake `xcrun` (#941): no Xcode, no network.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/bundle.xcresult"
fail=0
check() { # check <name> <command...>
  local name="$1"; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name" >&2; fail=1; fi
}
count_files() { find "$1" -type f | wc -l; }
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

run some "$tmp/o1"; rc=$?
check "exits 0 on a normal export" test "$rc" -eq 0
check "exports the ios-* PNGs" test -f "$tmp/o1/ios-pair-done_0_UUID.png" -a -f "$tmp/o1/ios-pair-refused_1_UUID.png"
check "copies nothing that is not an ios-* attachment" test "$(count_files "$tmp/o1")" -eq 2
run empty "$tmp/o2"; rc=$?
check "zero attachments exits 0" test "$rc" -eq 0
check "zero attachments leaves an empty dir" test "$(count_files "$tmp/o2")" -eq 0
run fail "$tmp/o3"; rc=$?
check "a failed export exits 0" test "$rc" -eq 0
run some "$tmp/o4" "$tmp/missing.xcresult"; rc=$?
check "a missing bundle exits 0" test "$rc" -eq 0
check "a missing bundle exports nothing" test "$(count_files "$tmp/o4")" -eq 0
exit "$fail"
