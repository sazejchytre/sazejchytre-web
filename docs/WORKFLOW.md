# Workflow

## Roles

| Role                      | Who                                                                                                      | Does                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Product owner / webmaster | the human approver for this repository; legal and payment decisions also need the operator, Adam Veverka | approves direction, merges, production actions, paid services                                          |
| Project management        | Claude (chat/Cowork)                                                                                     | issues, docs, prompts, review of agent reports, status                                                 |
| Implementer               | Claude Code                                                                                              | features, UI, design system, approved refactors, tests                                                 |
| Reviewer and auditor      | OpenAI Codex                                                                                             | independent review, security, webhooks, DB invariants, Playwright, deploy review, fixes it is assigned |

## Board

Columns: **Backlog → Ready → In Progress → Review → Testing → Done**.
Priorities: **P0** security, data or production critical · **P1** blocks
launch · **P2** important, not blocking · **P3** later.

An issue is **Ready** only when it has: goal, context, scope, out of scope,
acceptance criteria, required tests, dependencies, priority, agent.

## One task, start to finish

1. PM writes the issue and the agent prompt.
2. Claude Code creates a branch from `rebuild/v2` (worktree if parallel),
   implements, runs all checks, opens a PR into `rebuild/v2`.
3. Codex reviews the PR on its own branch checkout, posts findings as a PR
   review (blocking / non-blocking).
4. Claude Code fixes blocking findings on the same branch.
5. Codex re-reviews.
6. GitHub Actions green.
7. Product owner merges into `rebuild/v2`.
8. Staging deploy from `rebuild/v2`, Testing column, owner checks.
9. Production deploy only after owner approval and the launch checklist.

## Parallel work rules

- One agent per file at a time. Owned files are listed in the
  "Work in progress" table of `docs/STATUS.md`.
- Separate git worktree, branch, dev port (Claude Code 3000, Codex 3001) and
  database (`sc_claude`, `sc_codex` locally, never shared).
- Review work by Codex is read-only unless the issue assigns it a fix.

## Needs owner approval

Architecture or stack change, final visual direction, deleting files or data,
production migrations, production payments, merge to `main` (and to
`rebuild/v2`), production deploy, paid external services.

## Decided autonomously (and logged in DECISIONS.md)

Routine, safe, reversible choices: file layout inside existing modules,
naming, test structure, doc wording, issue breakdown.

## Status report format (PM to owner)

Done · Actually passed (real output) · In progress · Blocked · Decisions
needed · Next concrete step.
