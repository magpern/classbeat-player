#!/usr/bin/env bash
# Tests the Android release signing (issue #849): scripts/sign-android-apk.sh with fake apksigner
# and zipalign (no real key, no real secret, no Android SDK), and static checks of the Android jobs
# in .github/workflows/release-player.yml and of ci.yml's unsigned build. Touches no network.
# The workflow checks are functions that wf_check calls by name, which shellcheck cannot see.
# The patterns quote workflow text such as ${{ secrets.X }} literally.
# shellcheck disable=SC2329,SC2016
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
wf="$root/.github/workflows/release-player.yml"
ci="$root/.github/workflows/ci.yml"
fail=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

ok() { echo "ok: $*"; }
bad() { echo "FAIL: $*"; fail=1; }

# --- fake build tools ----------------------------------------------------------------------------
# The fake apksigner records its arguments and the keystore's mode at signing time, copies the input
# to --out, and prints a verify report shaped by FAKE_V2, FAKE_V3, FAKE_SIGNERS, FAKE_DIGEST and an
# optional second digest line FAKE_DIGEST2.
bin="$tmp/bin"
mkdir -p "$bin"
cat >"$bin/apksigner" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
log="$FAKE_LOG"
cmd="$1"
shift
case "$cmd" in
  sign)
    printf '%s\n' "sign $*" >>"$log"
    ks="" out="" last=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --ks) ks="$2"; shift 2 ;;
        --out) out="$2"; shift 2 ;;
        *) last="$1"; shift ;;
      esac
    done
    echo "keystore-mode $(stat -c %a "$ks")" >>"$log"
    echo "keystore-bytes $(cat "$ks")" >>"$log"
    [ "${FAKE_SIGN_FAIL:-0}" = 1 ] && exit 1
    cp "$last" "$out"
    ;;
  verify)
    printf '%s\n' "verify $*" >>"$log"
    echo "Verifies"
    echo "Verified using v1 scheme (JAR signing): false"
    echo "Verified using v2 scheme (APK Signature Scheme v2): ${FAKE_V2:-true}"
    echo "Verified using v3 scheme (APK Signature Scheme v3): ${FAKE_V3:-true}"
    echo "Number of signers: ${FAKE_SIGNERS:-1}"
    echo "Signer #1 certificate DN: CN=test"
    echo "Signer #1 certificate SHA-256 digest: ${FAKE_DIGEST}"
    if [ -n "${FAKE_DIGEST2:-}" ]; then echo "Signer #2 certificate SHA-256 digest: ${FAKE_DIGEST2}"; fi
    ;;
  *) exit 2 ;;
esac
FAKE
printf '#!/usr/bin/env bash\necho "zipalign $*" >>"$FAKE_LOG"\nexit "${FAKE_ALIGN_RC:-0}"\n' >"$bin/zipalign"
chmod +x "$bin/apksigner" "$bin/zipalign"

cert='10:3E:E1:B1:0D:73:44:25:AB:C6:7A:74:14:B3:06:F2:D2:EE:DD:EA:7E:A6:A6:6C:0D:A6:DF:35:D0:9B:DC:CA'
cert_hex="$(printf '%s' "$cert" | tr -d ':' | tr 'A-F' 'a-f')"
password='pw-not-real-7f3a'
alias='alias-not-real-c41d'
keystore_text='fake keystore bytes'
keystore_b64="$(printf '%s' "$keystore_text" | base64 -w0)"
printf 'unsigned apk' >"$tmp/in.apk"

n=0
# run_sign <env assignments...>: runs the script with a fresh SIGN_DIR, output and log; sets rc, the
# combined output in $tmp/run-$n/output, and $dir, $out and $log.
run_sign() {
  n=$((n + 1))
  local d="$tmp/run-$n"
  mkdir -p "$d"
  dir="$d/signing"
  out="$d/signed.apk"
  log="$d/log"
  : >"$log"
  rc=0
  env -i PATH="$bin:/usr/bin:/bin" SIGN_DIR="$dir" FAKE_LOG="$log" FAKE_DIGEST="$cert_hex" \
    ANDROID_CERT_SHA256="$cert" ANDROID_KEYSTORE_BASE64="$keystore_b64" \
    ANDROID_KEYSTORE_PASSWORD="$password" ANDROID_KEY_ALIAS="$alias" "$@" \
    bash "$here/sign-android-apk.sh" "$tmp/in.apk" "$out" >"$d/output" 2>&1 || rc=$?
  output="$d/output"
}
# refused <description>: the last run failed, left no keystore directory and no signed APK.
refused() {
  if [ "$rc" -ne 0 ] && [ ! -e "$dir" ] && [ ! -e "$out" ]; then ok "$1"; else bad "$1 (rc=$rc)"; fi
}

# The happy path, with fakes.
run_sign
if [ "$rc" -eq 0 ] && [ -s "$out" ] && [ ! -e "$dir" ]; then
  ok "signs, keeps the APK and removes the keystore directory"
else
  bad "happy path (rc=$rc): $(cat "$output")"
fi
signline="$(grep '^sign ' "$log" || true)"
for want in '--ks-pass env:ANDROID_KEYSTORE_PASSWORD' '--key-pass env:ANDROID_KEYSTORE_PASSWORD' \
  '--ks-type PKCS12' '--v2-signing-enabled true' '--v3-signing-enabled true' \
  '--v1-signing-enabled false' '--v4-signing-enabled false' "--ks-key-alias $alias"; do
  if grep -qF -- "$want" <<<"$signline"; then ok "apksigner sign gets $want"; else bad "apksigner sign lacks $want"; fi
done
if grep -qF -- "$password" "$log" "$output"; then bad "the password reached a command line or the output"; else ok "the password is on no command line and in no output"; fi
if grep -qF -- "$keystore_b64" "$log" "$output"; then bad "the encoded keystore reached a command line or the output"; else ok "the encoded keystore is on no command line"; fi
if grep -qx 'keystore-mode 600' "$log"; then ok "the keystore is mode 600 while signing"; else bad "keystore mode: $(grep keystore-mode "$log")"; fi
if grep -qx "keystore-bytes $keystore_text" "$log"; then ok "the keystore is decoded from base64"; else bad "keystore not decoded"; fi
if grep -q '^verify --verbose --print-certs ' "$log"; then ok "verifies with --print-certs"; else bad "no apksigner verify --print-certs"; fi
if grep -q '^zipalign -c 4 ' "$log"; then ok "checks the alignment"; else bad "no zipalign -c"; fi

# Each missing secret fails before anything is written, naming that secret and only that one.
secrets=(ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS)
for s in "${secrets[@]}"; do
  run_sign "$s="
  named=1
  grep -q "secret $s is missing" "$output" || named=0
  for other in "${secrets[@]}"; do
    if [ "$other" != "$s" ] && grep -q "secret $other is missing" "$output"; then named=0; fi
  done
  if [ "$rc" -eq 1 ] && [ "$named" -eq 1 ] && [ ! -e "$dir" ] && [ ! -s "$log" ] && [ ! -e "$out" ]; then
    ok "missing $s: fails, names it, runs nothing"
  else
    bad "missing $s (rc=$rc): $(cat "$output")"
  fi
done
run_sign ANDROID_KEYSTORE_BASE64= ANDROID_KEYSTORE_PASSWORD= ANDROID_KEY_ALIAS=
if [ "$rc" -eq 1 ] && [ "$(grep -c 'is missing or empty' "$output")" -eq 3 ] && [ ! -s "$log" ]; then
  ok "all secrets missing: names all three, runs nothing"
else
  bad "all secrets missing (rc=$rc)"
fi

# Every check can fail.
run_sign ANDROID_CERT_SHA256=
refused "no expected certificate refused"
run_sign ANDROID_KEYSTORE_BASE64='%%%not base64%%%'
refused "a keystore that is not base64 refused"
run_sign FAKE_ALIGN_RC=1
refused "an unaligned APK refused"
run_sign FAKE_SIGN_FAIL=1
refused "a failed apksigner sign refused"
run_sign FAKE_V2=false
refused "no v2 signature refused"
run_sign FAKE_V3=false
refused "no v3 signature refused"
run_sign FAKE_SIGNERS=2
refused "two signers refused"
# The certificate must match exactly (#853): a digest that is not the pinned one, a near miss at
# either end, a prefix or an extension of it, or a second certificate beside it, is refused.
other_cert="$(printf '%s' "$cert_hex" | tr '0-9a-f' '1-9a-f0')"
for d in "$other_cert" "${cert_hex%?}0" "f${cert_hex#?}" "${cert_hex%??}" "${cert_hex}00" "00${cert_hex}"; do
  run_sign FAKE_DIGEST="$d"
  refused "certificate ${d:0:8}..${d: -4} (${#d} hex) refused"
done
run_sign FAKE_DIGEST2="$other_cert"
refused "a second, different certificate digest refused"
# The pin is compared after normalising: the report's digest in upper case is accepted.
run_sign FAKE_DIGEST="$(printf '%s' "$cert_hex" | tr 'a-f' 'A-F')"
if [ "$rc" -eq 0 ] && [ -s "$out" ]; then ok "the pinned certificate in upper case is accepted"; else bad "upper-case digest (rc=$rc)"; fi
n=$((n + 1))
mkdir -p "$tmp/run-$n/signing"
dir_before="$tmp/run-$n/signing"
rc=0
env -i PATH="$bin:/usr/bin:/bin" SIGN_DIR="$dir_before" FAKE_LOG=/dev/null FAKE_DIGEST="$cert_hex" \
  ANDROID_CERT_SHA256="$cert" ANDROID_KEYSTORE_BASE64="$keystore_b64" ANDROID_KEYSTORE_PASSWORD="$password" \
  ANDROID_KEY_ALIAS="$alias" bash "$here/sign-android-apk.sh" "$tmp/in.apk" "$tmp/run-$n/out.apk" >/dev/null 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && [ -d "$dir_before" ]; then ok "an existing SIGN_DIR refused and left alone"; else bad "existing SIGN_DIR (rc=$rc)"; fi

# No run, passing or failing, printed a secret (#853): the alias is on apksigner's command line
# (sign-android-apk.sh says why) but never in the script's output, so xtrace or an echo fails here.
leaked=0
for o in "$tmp"/run-*/output; do
  if grep -qF -e "$alias" -e "$password" -e "$keystore_b64" -e "$keystore_text" -- "$o"; then
    leaked=1
    bad "a secret in $o"
  fi
done
[ "$leaked" -eq 1 ] || ok "no run printed the alias, the password or the keystore"
if [ "$(grep -o -- '--ks-key-alias' "$tmp/run-1/log" | wc -l)" -eq 1 ]; then ok "the alias is passed once"; else bad "the alias is not passed exactly once"; fi

# --- the workflow --------------------------------------------------------------------------------
wf_check() { # wf_check <description> <command...>: the command must succeed
  local what="$1"
  shift
  if "$@"; then ok "workflow: $what"; else bad "workflow: $what"; fi
}
job_block() { # job_block <file> <job> -> $tmp/job-<job>
  awk -v j="  $2:" '$0 == j {p=1; next} p && /^  [A-Za-z0-9_-]+:$/{exit} p' "$1" >"$tmp/job-$2"
  [ -s "$tmp/job-$2" ]
}
guard="needs.verify.outputs.publish == 'true' && github.event_name != 'pull_request' && startsWith(github.ref, 'refs/tags/player-v')"
# Secrets appear only in android-sign, only as the three env: lines of one step, each its own name.
secrets_only_in_sign() {
  local all in_sign s
  all="$(grep -c 'secrets\.' "$wf")"
  job_block "$wf" android-sign || return 1
  in_sign="$(grep -c 'secrets\.' "$tmp/job-android-sign")"
  [ "$all" -eq 3 ] && [ "$in_sign" -eq 3 ] || return 1
  for s in "${secrets[@]}"; do
    grep -qx "          $s: \${{ secrets.$s }}" "$tmp/job-android-sign" || return 1
  done
}
sign_guarded() {
  job_block "$wf" android-sign && grep -qxF "    if: $guard" "$tmp/job-android-sign"
}
publish_android_guarded() {
  job_block "$wf" publish-android && grep -qxF "    if: $guard" "$tmp/job-publish-android" &&
    grep -q 'contents: write' "$tmp/job-publish-android" &&
    grep -q 'sha256sum -c --strict SHA256SUMS-android' "$tmp/job-publish-android"
}
sign_cannot_write() {
  job_block "$wf" android-sign && ! grep -q 'contents: write' "$tmp/job-android-sign" &&
    ! grep -Eq 'npm|gradlew' "$tmp/job-android-sign"
}
# The keystore directory is removed in an always() step right after signing.
sign_cleans_up() {
  job_block "$wf" android-sign &&
    grep -A3 'bash scripts/sign-android-apk.sh' "$tmp/job-android-sign" | grep -q 'if: always()' &&
    grep -q 'rm -rf -- "$RUNNER_TEMP/android-signing"' "$tmp/job-android-sign"
}
pins_cert() { grep -qx "          ANDROID_CERT_SHA256: \"$cert\"" "$wf"; }
build_checks_manifest() {
  job_block "$wf" android-build && grep -q 'assembleRelease' "$tmp/job-android-build" &&
    grep -q 'check-apk-manifest.sh release' "$tmp/job-android-build" &&
    grep -qxF '          "$ANDROID_HOME/build-tools/36.0.0/zipalign" -c 4 "$apk"' "$tmp/job-android-build" &&
    ! grep -q 'secrets\.' "$tmp/job-android-build"
}
# ci.yml keeps building and checking the unsigned release APK with no secret (AC 5).
ci_unsigned() {
  job_block "$ci" mobile && grep -q 'assembleRelease' "$tmp/job-mobile" &&
    grep -q 'check-apk-manifest.sh release "$release"' "$tmp/job-mobile" &&
    grep -q 'app-release-unsigned.apk' "$tmp/job-mobile" && ! grep -q '${{ *secrets\.' "$ci"
}
artifacts_apart() { ! grep -Eq 'name: release-player-android' "$wf"; }

wf_check "secrets only as the three env: lines of android-sign" secrets_only_in_sign
wf_check "android-sign runs only when publishing from a player-v tag" sign_guarded
wf_check "publish-android is guarded and checks SHA256SUMS-android" publish_android_guarded
wf_check "android-sign has no write access and runs no npm or Gradle" sign_cannot_write
wf_check "the keystore directory is removed in an always() step" sign_cleans_up
wf_check "the expected certificate is pinned" pins_cert
wf_check "android-build runs assembleRelease, the release manifest check and zipalign -c 4" build_checks_manifest
wf_check "Android artifacts stay out of checksums' release-player-*-* pattern" artifacts_apart
wf_check "ci.yml still builds and checks the unsigned APK" ci_unsigned

exit "$fail"
