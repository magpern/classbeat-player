# Runbook: build the desktop app on a Mac

For a developer who wants the app on their own Mac, from a fresh clone. The build is
**unsigned and unnotarized**; nothing here signs anything or uses a secret.

Needs: macOS, Node 24, and the Xcode command line tools (`xcode-select --install`).

```bash
scripts/build-mac.sh              # archive in dist-local/
scripts/build-mac.sh --out ~/Desktop/cb
scripts/build-mac.sh --out ~/Desktop/cb --open   # also unpack there and start the app
scripts/build-mac.sh --clean      # reinstall dependencies with npm ci even if they are up to date
```

The script checks the prerequisites and stops with a message if one is missing, runs `npm ci` in
`schema/ts` and `player/app` (only when needed, see below), runs `npm run build` in `player/app`, then calls
`scripts/package-desktop.sh` with the label `macos-arm64` or `macos-x64`. It prints the archive
path, `classbeat-player-<label>-unsigned.tar.gz`. Unpack it with `tar -xzf <archive> -C <dir>`;
the folder `classbeat-player-<label>/` contains `Electron.app`. With `--open` the script does that
itself (replacing an earlier unpack in `<dir>`) and starts the app with `open`; if macOS refuses the
unsigned app it prints the right-click, Open step. It changes no macOS security settings.

Dependencies are reused. After a successful `npm ci` the script saves a stamp (a copy of
`package.json` and `package-lock.json`) in `node_modules/.classbeat-install-stamp`. A later run
skips `npm ci` in that folder while the stamp still equals the two files, and for `player/app`
while `node_modules/electron/dist` exists, and prints `reusing the installed dependencies`. A
changed lockfile or `package.json`, a missing `electron/dist` or `--clean` runs `npm ci` again.
`npm run build` always runs.

A newer npm skips install scripts that `allowScripts` does not cover, and then Electron's own
script never downloads its runtime. After the build the script checks for
`player/app/node_modules/electron/dist`; if it is missing it runs
`node node_modules/electron/install.js` in `player/app` (the version pinned in the lockfile; this
downloads the runtime, so it needs the network) and stops with a clear message if that still
produces no runtime. The download goes through Electron's own cache (`ELECTRON_CACHE`, which the
script sets to `~/Library/Caches/electron` unless you set it), so a refetch after `--clean` is
served from the cache when the same version is already there. You can run that command by hand. esbuild builds without its postinstall,
so nothing else needs fetching. The script creates the `--out` directory first and stops early if
it cannot be used. Nothing in npm's configuration is changed.

Because the app is unsigned, macOS may refuse to open it. The script does not change quarantine
or Gatekeeper settings; how to open an unsigned app is the developer's own decision on their own
machine.

Test: `bash scripts/test-build-mac.sh` (stub tools, no Mac needed; also runs in CI).
