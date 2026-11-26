#!/usr/bin/env bash
# Signs the Android release APK with the project key and checks the result (issue #849, ADR 0011
# section 9). Run by the android-sign job of .github/workflows/release-player.yml, only on a
# publishing player-v tag; tested with fake tools by scripts/test-sign-android-apk.sh.
# Usage: sign-android-apk.sh <unsigned.apk> <signed.apk>
# Secrets, read from the environment only (never a script argument, never printed):
#   ANDROID_KEYSTORE_BASE64     the PKCS12 keystore, base64; decoded through a pipe to a mode-600 file
#   ANDROID_KEYSTORE_PASSWORD   its password (also the key's: PKCS12 has one), handed to apksigner
#                               as `env:ANDROID_KEYSTORE_PASSWORD`, so the value is on no command line
#   ANDROID_KEY_ALIAS           the key's alias, the one secret on a command line (apksigner sign's
#                               --ks-key-alias). apksigner reads passwords from env:, file: or stdin
#                               but takes the alias only as a literal argument, with no env or file
#                               form, and leaving it out works only for a one-key keystore. The alias
#                               opens nothing without the keystore and its password, the argv is
#                               visible only on this ephemeral runner, and this script never prints
#                               it (no xtrace; scripts/test-sign-android-apk.sh checks every output).
# Not secret:
#   ANDROID_CERT_SHA256  the signing certificate's SHA-256, hex with or without colons; the signed
#                        APK must carry exactly this certificate
#   SIGN_DIR             where the keystore is decoded (default $RUNNER_TEMP/android-signing); it
#                        must not exist yet, is mode 700, and is removed when the script exits
#   APKSIGNER, ZIPALIGN  the build tools (default: on the PATH)
# A missing secret fails before anything is written, naming each one. Signing is v2 and v3 only:
# v1 (JAR) signing is off because the app's minSdk is 28, and v4 would add an .idsig file.
set -euo pipefail
umask 077

die() { echo "sign-android-apk: $*" >&2; exit 1; }

[ "$#" -eq 2 ] || { echo "usage: $0 <unsigned.apk> <signed.apk>" >&2; exit 2; }
in="$1"
out="$2"

missing=0
for name in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS; do
  if [ -z "${!name:-}" ]; then
    echo "sign-android-apk: the repository secret $name is missing or empty; the APK is not signed and not released" >&2
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

want="$(printf '%s' "${ANDROID_CERT_SHA256:-}" | tr -d ':' | tr 'A-F' 'a-f')"
[[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "ANDROID_CERT_SHA256 must be the certificate's SHA-256 (64 hex digits)"
[ -s "$in" ] || die "no unsigned APK at $in"
[ ! -e "$out" ] || die "refusing to overwrite $out"
apksigner="${APKSIGNER:-apksigner}"
zipalign="${ZIPALIGN:-zipalign}"

dir="${SIGN_DIR:-${RUNNER_TEMP:?RUNNER_TEMP or SIGN_DIR must be set}/android-signing}"
mkdir -m 700 -- "$dir" || die "cannot create a new $dir"
# The signed output is removed too unless every check below passed.
signed=0
cleanup() {
  rm -rf -- "$dir"
  if [ "$signed" -ne 1 ]; then rm -f -- "$out"; fi
}
trap cleanup EXIT

ks="$dir/keystore.p12"
: >"$ks"
chmod 600 "$ks"
# printf is a shell builtin: the encoded keystore reaches base64 through a pipe, not an argument.
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d >"$ks" 2>/dev/null ||
  die "ANDROID_KEYSTORE_BASE64 is not valid base64"
[ -s "$ks" ] || die "ANDROID_KEYSTORE_BASE64 decodes to nothing"
[ "$(stat -c %a "$ks")" = 600 ] || die "the decoded keystore is not mode 600"

# AGP aligns the release APK; v2 and v3 signatures need that alignment, so check rather than redo it.
"$zipalign" -c 4 "$in" >/dev/null || die "the unsigned APK is not 4-byte aligned"

"$apksigner" sign \
  --ks "$ks" --ks-type PKCS12 --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEYSTORE_PASSWORD \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
  --v4-signing-enabled false \
  --out "$out" "$in" || die "apksigner sign failed"
rm -f -- "$ks"

report="$dir/verify.txt"
"$apksigner" verify --verbose --print-certs "$out" >"$report" || die "apksigner verify refused the signed APK"
# The report holds the certificate's names and digests, nothing secret.
cat "$report"
grep -Fxq 'Verified using v2 scheme (APK Signature Scheme v2): true' "$report" || die "not signed with the v2 scheme"
grep -Fxq 'Verified using v3 scheme (APK Signature Scheme v3): true' "$report" || die "not signed with the v3 scheme"
grep -Fxq 'Number of signers: 1' "$report" || die "the APK must have exactly one signer"
digests="$(sed -n 's/^Signer.* certificate SHA-256 digest: \([0-9a-fA-F]*\)$/\1/p' "$report" | tr 'A-F' 'a-f' | sort -u)"
[ -n "$digests" ] || die "apksigner printed no certificate digest"
[ "$digests" = "$want" ] || die "signed with certificate $digests, expected $want"

signed=1
echo "sign-android-apk: signed $out (v2+v3, certificate SHA-256 $want)" >&2
