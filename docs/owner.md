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
- **Spike 2 (scene):** run the scene builds on a studio-class computer with a second display.
- **Swedebeat:** whether to ask for an agreement and a source of the audio.
