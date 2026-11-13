# Runbook: build the desktop app on a Mac

For a developer who wants the app on their own Mac, from a fresh clone. The build is
**unsigned and unnotarized**; nothing here signs anything or uses a secret.

Needs: macOS, Node 24, and the Xcode command line tools (`xcode-select --install`).

```bash
scripts/build-mac.sh              # archive in dist-local/
scripts/build-mac.sh --out ~/Desktop/cb
```

The script checks the prerequisites and stops with a message if one is missing, runs `npm ci` in
`schema/ts` and `player/app`, runs `npm run build` in `player/app`, then calls
`scripts/package-desktop.sh` with the label `macos-arm64` or `macos-x64`. It prints the archive
path, `classbeat-player-<label>-unsigned.tar.gz`. Unpack it with `tar -xzf <archive> -C <dir>`;
the folder `classbeat-player-<label>/` contains `Electron.app`.

Because the app is unsigned, macOS may refuse to open it. The script does not change quarantine
or Gatekeeper settings; how to open an unsigned app is the developer's own decision on their own
machine.

Test: `bash scripts/test-build-mac.sh` (stub tools, no Mac needed; also runs in CI).
