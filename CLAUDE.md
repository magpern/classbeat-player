@AGENTS.md

## Running the agents in Claude Code

- The main session is the **Orchestrator**. It does not write product code and does not review.
- It starts the other roles as background subagents from `.claude/agents/`, several in one
  message so they run at the same time: one `developer` per unblocked issue, each in an isolated
  worktree; a `reviewer` per pull request; the `designer` and `verifier` when section 5 and
  section 4 of AGENTS.md call for them.
- The first review of a pull request is a new `reviewer`. Later rounds on that pull request
  resume the same one with the new head commit.
- Pass a top-tier model when spawning for a security-critical or rule-sensitive pull request.
- Never ask the owner in chat whether to continue, skip a review or start the next issue. Open
  owner items go in `docs/owner.md`.

## Before any merge

No `Agent review (<model>): PASS <sha>` for the pull request's current head commit means no
merge. Where a user sees the change, no `Design review: PASS <sha>` means no merge. Your own
check, green CI and passing tests are not a `PASS`.

## Code structure

1. **Small, cohesive modules.** One clear responsibility per file, under about 300 lines (about
   150 for pure rule modules). Never split a cohesive function to meet a number.
2. **Pure core first.** Rules and calculations (the class clock, the music-link state machine,
   the timing model, format conversion) live in pure modules that import no I/O: no database,
   network, filesystem, operating-system call or UI. Side effects sit at the edge.
3. **Split on touch.** A change to a source file already over 300 lines moves one cohesive part
   out in the same pull request.
4. **Frugal checks.** Read with a search or a line range before reading a whole large file.
   Locally run only the tests that cover the change; CI runs the rest.

Generated files, lockfiles, migrations and long table-driven tests are exempt from 1 and 3.

## Commits

Conventional Commits 1.0.0. No `Co-Authored-By` trailer. Never commit `.env`, tokens, keys or
anything under `secrets/`.
