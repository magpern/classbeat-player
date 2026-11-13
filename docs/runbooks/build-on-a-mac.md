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

A newer npm skips install scripts that `allowScripts` does not cover, and then Electron's own
script never downloads its runtime. After the build the script checks for
`player/app/node_modules/electron/dist`; if it is missing it runs
`node node_modules/electron/install.js` in `player/app` (the version pinned in the lockfile; this
downloads the runtime, so it needs the network) and stops with a clear message if that still
produces no runtime. You can run that command by hand. esbuild builds without its postinstall,
so nothing else needs fetching. The script creates the `--out` directory first and stops early if
it cannot be used. Nothing in npm's configuration is changed.

Because the app is unsigned, macOS may refuse to open it. The script does not change quarantine
or Gatekeeper settings; how to open an unsigned app is the developer's own decision on their own
machine.

Test: `bash scripts/test-build-mac.sh` (stub tools, no Mac needed; also runs in CI).
