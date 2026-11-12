# Class player (working name)

A desktop player for indoor-cycling classes: the class profile, the current interval, the time
left, the target effort, cadence, BPM and what comes next, following the music as it plays.
Classes are made in [classbeat](https://github.com/magpern/classbeat) and sent here; this
product has its own backend, accounts and releases and shares no code with classbeat.

**Status: plan only, nothing is built.** Read [docs/plan.md](docs/plan.md); the owner's open
decisions are in its section 13.

Planned layout:

| Path | What |
|---|---|
| `backend/` | Accounts, the class library, paired devices, the API for sources and for the player |
| `schema/` | The class format: a versioned JSON Schema and the types generated from it |
| `player/` | The desktop application (macOS, Windows, Linux best effort) |
| `docs/` | The plan and, later, the decision records |

Not made by or affiliated with Intelligent Cycling (MOWL), Spotify or Swedebeat.
