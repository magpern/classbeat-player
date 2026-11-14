# Runbook: the owner's Mac

Everything [owner.md](../owner.md) asks you to run on a Mac. None of it needs the backend, Docker or
an account with us: each task runs on its own with Node.

## Once

1. Apple's command line tools (they include `git`): in Terminal, `xcode-select --install`.
2. Node 24 from nodejs.org (the macOS installer). Check with `node -v`.
3. The code:

   ```bash
   git clone https://github.com/magpern/classbeat-player.git
   cd classbeat-player
   ```

   Every block below starts from this `classbeat-player` folder. Later, to get the newest
   version: `git pull` in it.

## Spike 1: following the music

Needs the Spotify desktop app, signed in, with the class playlist. Full steps and the three runs:
[player/spikes/music-follower/README.md](../../player/spikes/music-follower/README.md).

```bash
cd player/spikes/music-follower
npm ci && npm run build
cp example/class.spike.json my-class.json   # then list your playlist's songs in it, in order
node dist/cli.js --class my-class.json --out run-xfade-off-mac.jsonl
```

The first run asks to let Terminal control Spotify; allow it. `q` quits. Hand back the `.jsonl`
log files.

## Spike 2: the scene

Run it on the studio computer with its one screen mirrored on the projector, as in a class. Wait
for the harness's one-screen mode (#447) first. Full steps and the checklist:
[player/scene/spike/README.md](../../player/scene/spike/README.md).

```bash
cd player/scene/spike
npm ci
npm start                                  # the web variant
npm start -- --variant=godot-native        # needs the Godot builds; agents can hand you a zip
```

## The player app

To try the desktop app itself. It starts without the backend, but cannot pair or sync classes
until a backend is running somewhere. Details: [build-on-a-mac.md](build-on-a-mac.md).

```bash
cd ~/classbeat-player        # or wherever you cloned it: the repository's top folder
scripts/build-mac.sh --out ~/Desktop/cb --open
```

With `--open` it unpacks the archive into that folder (replacing an earlier unpack) and starts the app. The
build is unsigned, so macOS may refuse to open it; the script then prints the right-click, Open step. Whether
to allow it is your decision on your own Mac.
