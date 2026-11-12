# For the owner

What only the owner can do or decide (AGENTS.md, section 1). Agents add items here and carry on
with other work; nothing in the development loop waits for an answer.

## One-time setup

- **Branch rules on `main`:** require a pull request, the CI checks as required checks (their
  names come with the first CI pull request in PL0), squash merges only, no direct pushes.
  Agents never change repository settings.
- **Signing accounts** (before PL7): an Apple Developer membership and a Windows signing identity.

## Decisions waiting

- The decisions in [plan.md](plan.md), section 13. Decided so far: the backend stack (Python,
  FastAPI, PostgreSQL); no phone app of our own, with Bluefy on iPhone for sensors; no external
  hardware such as lighting.

## Tasks only the owner can run

- **Spike 1 (music):** run the follower tool, once it exists, on a Mac and a Windows machine with
  a real Spotify account, and hand back the log file.
- **Spike 2 (scene):** run the scene builds on a studio-class computer with a second display.
- **Swedebeat:** whether to ask for an agreement and a source of the audio.
