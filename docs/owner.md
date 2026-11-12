# For the owner

What only the owner can do or decide (AGENTS.md, section 1). Agents add items here and carry on
with other work; nothing in the development loop waits for an answer.

## One-time setup

- **Branch rules on `main`:** require a pull request, the required checks **`ci`** and
  **`pr-title`** (nothing else), squash merges only, no direct pushes, zero required approvals,
  no "branch must be up to date". Agents never change repository settings.
- **Milestones:** the agents' tools cannot create GitHub milestones, so phases are labels
  (`PL0`, …). Create milestones PL0 to PL11 if you want them; agents will use them.
- **A mail service** (before the first deploy): sign-in links and security notices are sent by
  mail (ADR 0002). Which service, and the sending domain.
- **Signing accounts** (before PL7): an Apple Developer membership and a Windows signing identity.

## Decisions waiting

- **Defaults agents picked that you may want to change** (ADR 0002, once merged, lists them all):
  sign-up by allowlist only; sign-in links work only in the browser that asked for them; no
  local lock on a studio computer shared by several instructors; account deletion removes
  everything, including removal markers and audit events; 8-letter join codes.
- The decisions in [plan.md](plan.md), section 13. Decided so far: the backend stack (Python,
  FastAPI, PostgreSQL); no phone app of our own, with Bluefy on iPhone for sensors; no external
  hardware such as lighting.

## Tasks only the owner can run

- **Spike 1 (music):** run the follower tool, once it exists, on a Mac and a Windows machine with
  a real Spotify account, and hand back the log file.
- **Music link live checks (PL5 is done on fakes).** With a real Spotify account, on macOS,
  Windows and Linux, run a class while following the music and check:
  - interval timing within 1 s for at least 95% of the class, and never more than 2 s off for
    more than 5 s;
  - crossfade off, 5 s and 9 s: the song change is seen within 1 s and the clock never runs
    backwards;
  - pause, seek, next and previous done in Spotify are followed;
  - the player's transport buttons really reach Spotify;
  - a recording that appears twice in the class (ambiguous) is handled;
  - a song that is not in the class shows "Off the list";
  - quitting and restarting Spotify during a class;
  - Windows timestamps; the 30 s repair path; an hour with no drift;
  - the beat flash is within 50 ms of the beat for at least 90 % of beats;
  - the helper process stops when the app quits;
  - Linux without MPRIS shows "following the music is unavailable".
- **Music readers, facts agents could not check:**
  - Windows: Spotify's ids (`Spotify.exe`, `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`) were
    taken from memory; PowerShell with `-InputFormat None` and its 15 s start-up.
  - Linux: `busctl` exists only on systemd systems; a real capture of Spotify's MPRIS
    properties is needed, including whether `Position` moves.
  - macOS: how the Automation permission prompt behaves, and the entitlement a packaged build
    needs.
- **Product call:** when Spotify is paused while a browser plays other music, the player shows
  "Off the list". Say if you want something else.
- **Spike 2 (scene):** run the scene builds on a studio-class computer with a second display.
- **Swedebeat:** whether to ask for an agreement and a source of the audio.
