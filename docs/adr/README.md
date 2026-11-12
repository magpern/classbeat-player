# Architecture decision records

Written by the Orchestrator, reviewed in their own pull request by a Reviewer who did not write
them (AGENTS.md, section 9). The [plan](../plan.md) wins where an ADR and the plan differ; an
ADR that changes a decision says which one it replaces.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-application-stack-music-link-and-timing.md) | Application stack, music link and timing model | Accepted |
| 0002 | Accounts, pairing and tokens | In progress (#3) |
| 0003 | Class format | Planned |
| 0004 | Provider terms | Planned |

## Template

File name: `NNNN-short-title.md`, numbered in order, never reused.

```markdown
# NNNN. Title

Status: Proposed | Accepted (date) | Replaced by NNNN (date)

## Context
What forces the decision, with the plan sections it rests on.

## Decision
What we do, stated so a Developer can build it and a Reviewer can check it.

## Alternatives
What else was considered and why not.

## Consequences
What becomes easier, what becomes harder, what must be watched.
```
