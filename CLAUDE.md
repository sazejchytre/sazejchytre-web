@AGENTS.md

# Claude Code specifics

Everything in `AGENTS.md` applies. This file only adds what is specific to
Claude Code.

- **Role:** primary implementer (frontend, design system, features from
  issues, approved refactors, tests). OpenAI Codex reviews your PRs; treat its
  findings as blocking until resolved or explicitly waived by the product
  owner.
- **Start of every task:** read the issue, `docs/STATUS.md` and the docs
  listed for the area in `AGENTS.md`. Then state in one short paragraph what
  you will change and what you will not.
- **Parallel work:** if Codex is working at the same time, use a separate git
  worktree (`git worktree add ../sc-<nnn> -b <branch> rebuild/v2`), a separate
  dev port (`pnpm dev --port 3001`) and a separate database. Never edit a file
  listed as "owned" by an open Codex branch in `docs/STATUS.md`.
- **UI work:** follow `docs/DESIGN.md`. Do not start a page redesign until the
  design direction is marked approved in `docs/DECISIONS.md`.
- **End of every task:** commit, push the branch, open a PR into
  `rebuild/v2` with `gh pr create --base rebuild/v2`, then report in chat:
  PR link, commit hash, 1 to 3 sentences on what changed, the real summary
  lines of every check you ran, and anything that needs a human decision. No
  report files in the repo.
- **Do not** merge, deploy, run migrations against anything but a local or
  dedicated dev database, or touch the production VPS.
