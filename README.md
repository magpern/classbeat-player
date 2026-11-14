# Class player (working name)

A desktop player for indoor-cycling classes: the class profile, the current interval, the time
left, the target effort, cadence, BPM and what comes next, following the music as it plays.
Classes are made in [classbeat](https://github.com/magpern/classbeat) and sent here; this
product has its own backend, accounts and releases and shares no code with classbeat.

**Status:** the class format, the desktop player with its music link, the plain 2D room screen,
the backend with sign-in, the website and the phone companion are built and tested on fakes; the 3D
scene waits for spike 2. Where things stand: [docs/status.md](docs/status.md). The plan:
[docs/plan.md](docs/plan.md). Running things on your own Mac:
[docs/runbooks/owner-mac.md](docs/runbooks/owner-mac.md).

Layout:

| Path | What |
|---|---|
| `backend/` | Accounts, the class library, paired devices, the API for sources and for the player |
| `schema/` | The class format: a versioned JSON Schema and the types generated from it |
| `player/` | The desktop application (macOS, Windows, Linux best effort), its spikes and the scene (`player/scene/`) |
| `web/` | The plain 2D screen, the website, the phone page and the handlebar companion |
| `docs/` | The plan, status, decision records (`docs/adr/`), design specs and runbooks |
| `docker/`, `scripts/` | The backend's container files, build and CI scripts |

Not made by or affiliated with Intelligent Cycling (MOWL), Spotify or Swedebeat.
