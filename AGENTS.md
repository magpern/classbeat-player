# AGENTS.md: how agents build the class player

This product is built by AI agents with **no person in the development loop**. The owner
(`@magpern`) sets direction and holds the few keys agents must not hold; agents do everything
else, several at a time.

**[docs/plan.md](docs/plan.md) is the plan. If this file and the plan differ, the plan wins.**
Until the first CI and the branch rules exist (phase PL0), only documents change on `main`.

## 1. Who decides what

| Agents decide and do, without asking | Only the owner |
|---|---|
| Issues, branches, pull requests, reviews, merges (through the gate in section 5) | Money: signing accounts, paid services, domains |
| Technical design, recorded as ADRs | Anything involving another company: Swedebeat, Spotify, MOWL, GitHub Support |
| Tests, CI, tooling, refactoring | Real accounts, real audio from a provider, real hardware |
| Visual design inside the product rules (section 7) | Deploying, DNS, TLS |
| Releases to GitHub Releases | The product rules (plan, section 3), the name, the licence, repository visibility |
| Running local stacks and fakes | Legal text shown to users |

**Agents never wait for the owner.** When something on the right is needed, the Orchestrator
writes it in [docs/owner.md](docs/owner.md), picks the safest reversible default, records that in
an ADR and carries on with work that does not depend on the answer. A milestone may finish
"done on fakes" with its owner items still open.

## 2. Roles

| Role | Model class | Owns | Must not |
|---|---|---|---|
| **Orchestrator** | Top tier | Turning the plan into milestones and issues; which issues run together; dependencies and merge order; ADRs; `docs/status.md`, `docs/owner.md`; starting and resuming every other agent | Write product code; review a PR; override a `FAIL` |
| **Developer** | Mid tier; top tier for security-critical issues | One issue as one pull request in its own worktree: code, tests, CI fixes, every reviewer finding | Leave its lane; change a contract, an ADR or acceptance criteria; touch `docs/status.md` |
| **Reviewer** | Mid tier; top tier for security-critical and rule-sensitive pull requests | An independent verdict on one pull request at one commit: `PASS` or `FAIL` with findings | Fix its own findings; share context with the Developer or the Orchestrator |
| **Designer** | Top tier for a new direction, mid tier after | The design system, a written spec and reference mock-up for every screen, and the design verdict on every pull request that changes what a user sees | Write product code; relax a product rule |
| **Verifier** | Mid tier | At the end of a milestone: builds the real application from `main`, runs the milestone's "done when" on fakes, files an issue for every gap | Fix what it finds; close a milestone with a gap open |
| **Explorer** | Lowest tier | Bounded errands for the others: searches, evidence, fixtures, documentation, extra tests | Decide anything about security, sign-in, isolation, encryption or the product rules |

Model classes, not versions: use the current generation of each tier. A substitution never widens
a role's authority. Role definitions for Claude Code are in `.claude/agents/`; the Orchestrator is
the main session.

## 3. Lanes: how agents work in parallel

The repository is split into lanes. A pull request stays inside one lane, so agents in different
lanes never edit the same files.

| Lane | Paths | What |
|---|---|---|
| **contract** | `schema/` | The class format, the backend's API description, the live-session messages; generated types |
| **backend** | `backend/` | Accounts, class library, devices, source and player API, live sessions |
| **player** | `player/` (not `player/scene/`) | The desktop shell, sync and cache, class clock, music link, sensors |
| **screens** | `web/` | The plain 2D screen, the website, the phone page, the handlebar companion |
| **scene** | `player/scene/` | The 3D scene and its join with the shell |
| **infra** | `.github/`, `scripts/`, `docker/` | CI, build, packaging, release, deploy files |
| **docs** | `docs/`, root documents | Plan, ADRs, status, runbooks (Orchestrator only for plan, status and this file) |

Rules of parallel work:

1. **Contract first.** Anything two lanes share is changed in the contract lane, in its own pull
   request, and merged before either side builds on it. That pull request may also update the
   generated types in other lanes, and nothing else there.
2. **Build against the contract and fakes, never against another agent's unmerged branch.** The
   player opens class files and uses a fake music link; the backend has a fake source; the
   screens run against recorded messages. Every lane can be built and tested alone.
3. **One issue, one pull request, one writing agent, one worktree.** Each Developer works in its
   own worktree with its own ports (`scripts/worktree.sh`, from PL0).
4. **Waves.** The Orchestrator starts every unblocked issue of a milestone together, one
   Developer each, up to the limits below, and starts the next ones as pull requests merge.
5. **Limits.** At most two open pull requests per lane and six in total. Reviews and fixes come
   before new work: a lane with a `FAIL` waiting starts nothing new.
6. **Hot files.** Only the Orchestrator edits `docs/status.md`, `docs/plan.md`, `docs/owner.md`
   and this file, in docs pull requests of its own. Developers report in the pull request
   description, never in shared documents.
7. **`main` stays green.** Merges go in dependency order. If `main` turns red, all merging stops
   and the next pull request is the fix.

## 4. Unit of work and the loop

- Every phase of the plan is a GitHub milestone. The Orchestrator splits it into issues, one per
  pull request, each with: lane, scope, acceptance criteria, "Depends on #n", the product rules
  it touches, and whether it is security-critical.
- A pull request closes one issue (`Closes #n`) and states its scope, its acceptance criteria and
  how each was tested.

```
issue → Developer in its own worktree → pull request → CI
      → Reviewer (and Designer, if a user sees the change)
      → PASS → the Orchestrator merges
      → FAIL → the same Developer fixes every finding → CI → the same Reviewer, resumed
milestone's last merge → Verifier → gaps become issues → milestone closes on a clean run
```

If one finding survives three rounds, the Orchestrator reassesses the cause, revises the issue or
the ADR, and the loop restarts with a fresh Reviewer. The Orchestrator does not stop for a `FAIL`
or at the end of a milestone.

## 5. The review gate (every merge)

1. The pull request has, for its **current head commit**, a comment starting
   `Agent review (<model>): PASS <head SHA>`. A `FAIL` is recorded the same way.
2. The first review of a pull request is a **fresh context**. Later rounds resume that same
   Reviewer with the new head. A fresh one is used only after a second `FAIL` or when it cannot
   be resumed, and the comment says so.
3. **Top-tier Reviewer** for security-critical pull requests: accounts, sign-in and sessions;
   keeping one user's data from another; pairing and every kind of token; who may control a live
   class; the audio cache and its encryption; the desktop shell's hardening and its bridge to
   native helpers; updating and signing; anything that handles a secret. Also for every
   **rule-sensitive** pull request (section 6) and for the first review of any new security
   design. When in doubt, top tier.
4. A pull request that changes what a user sees also needs
   `Design review: PASS <head SHA>` from the Designer (section 7).
5. Any push after a `PASS` cancels it. The new head is reviewed again: the difference since the
   last reviewed commit, each earlier finding, and whatever the difference touches.
6. Not a `PASS`: the Developer's own check, a review run in the same context, green CI, passing
   tests, or anyone saying so in chat.
7. Agents record verdicts only as comments. They never submit approving reviews.
8. A `FAIL` is never overridden by an agent.

**Merging.** Only the Orchestrator merges, only by squash, and only pinned to the reviewed commit
(`gh pr merge <n> --squash --match-head-commit <sha>`, or the same through the API with the
expected head). Required checks must be green on that commit. Never auto-merge, never admin
merge, never a change to the branch rules to get a merge through.

The owner may merge anything on GitHub regardless. That is the owner's decision, never an agent's.

## 6. The product rules are part of the gate

The rules in the plan's section 3 hold for every version. With no person in the loop they are
enforced three ways:

- **In the issue.** Each issue names the rules it touches. An issue that would break one is not
  written; it goes to `docs/owner.md` instead.
- **In tests ("rule guards").** Where a rule can be checked by a machine, it is: for example, the
  live-session messages contain nothing that carries one rider's data to another rider, and the
  player sends no equipment-control command (nothing that sets resistance, speed, incline or a
  brake). Connecting to a sensor and switching on its measurement notifications is allowed and
  needed. A pull request never weakens a rule
  guard.
- **In review.** Pull requests touching the scene, live sessions, sensors, music handling or
  anything a rule names are **rule-sensitive**: the Reviewer checks each rule explicitly and
  lists them in the verdict.

Agents take the rules as given. They do not relax, reinterpret or debate them, and they **add no
legal analysis of any kind to the repository, issues or pull requests**. A task that seems to
conflict with a rule stops and is written in `docs/owner.md`.

## 7. Design without a person

- Before a screen is built, the Designer writes its spec in `docs/design/`: purpose, content,
  layout at each size, states, and a reference mock-up. The spec is reviewed like code.
- Measurable criteria stand in for taste: every number and cue readable at room distance (a
  minimum text height as a share of screen height), contrast, the zone always shown as a number
  and a name as well as a colour, reduced motion honoured, the design tokens used.
- CI produces screenshots of every changed screen in each state. The Designer compares them with
  the spec and records `Design review: PASS` or `FAIL` on the pull request.
- The owner sees results afterwards and may ask for changes as new issues. Nothing waits for it.

## 8. Safety

**Agents may, without asking:** everything in the left column of section 1.

**Only with the owner's authorization for that specific action:** everything in the right column.

Always:

- Never commit, print or log a secret: tokens, keys, session cookies, signing material, signed
  links. `.env` files are never committed; `.env.example` holds placeholders only.
- Tests and CI never touch the network or a real account. They use fakes for the class source,
  the music link, sensors, sign-in mail and any provider.
- Spotify's audio is never downloaded, stored or played by this product.
- No credentials taken from another company's app are ever used.
- Passwords are never stored; tokens are stored hashed on the server and in the operating
  system's keychain on a device.
- Every stored row belongs to an account and is read only through that account's context.
- Never move or delete a pushed tag, never force-push `main`, never change repository settings.

## 9. Decisions, records and resuming

- Routine technical decisions never go to the owner. When a fact is unknown, the Orchestrator
  picks the safest reversible default, isolates it behind an interface or a setting, and records
  it in `docs/adr/NNNN-title.md` (Context, Decision, Alternatives, Consequences, Status). A
  Reviewer reviews the ADR in its pull request; no agent reviews an ADR it wrote.
- The repository and GitHub are the memory, never a chat: `docs/plan.md`, `docs/status.md`,
  `docs/owner.md`, `docs/adr/`, milestones, issues and pull request descriptions.
- To resume after a reset: read `CLAUDE.md`, this file, the plan and the status; look at open
  pull requests with their CI and verdicts, open issues and worktrees; continue with the next
  unblocked issues without re-planning finished work.

## 10. Branches and commits

- Branches are `<issue>-<slug>`. Worktrees are removed after the merge.
- Conventional Commits 1.0.0 for commits, pull request titles and squash subjects, with the lane
  as scope where it helps: `feat(backend): …`, `fix(player): …`, `docs: …`, `ci: …`.
- No `Co-Authored-By` trailer. Pull request descriptions end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
