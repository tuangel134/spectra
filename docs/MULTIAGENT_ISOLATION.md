# Spectra multi-agent isolation

Spectra runs writing agents in separate Git worktrees and branches. The main workspace remains untouched until a task passes review.

## Safety model

1. Tasks declare `files` claims in `tasks.md`.
2. The scheduler adds serialization edges when claims overlap.
3. A cross-process lease prevents two running agents from owning overlapping paths.
4. Each agent receives its own worktree and branch at the run's base commit.
5. Spectra compares the actual patch with the declared claims.
6. The task validation command must pass inside the worktree.
7. Spectra commits the isolated patch.
8. Integration is a sequential cherry-pick into a clean main workspace.
9. Validation runs again after integration.
10. Conflicts or failed validation abort and roll back the integration.

Tasks without file claims are treated as global writers and run alone. This is intentionally conservative.

## Recovery

Run state is persisted in Spectra's platform state directory, outside the repository. On restart, active tasks become `interrupted`, worktrees remain available for inspection, and stale path leases are released.

## API

- `GET /api/multiagent`
- `POST /api/multiagent/plan`
- `POST /api/multiagent/runs`
- `GET /api/multiagent/runs/:id`
- `POST /api/multiagent/runs/:id/start`
- `POST /api/multiagent/runs/:id/cancel`

The Desktop panel can create and monitor isolated runs from an existing spec.

## Durable state

Run records and file leases live outside the working tree in the platform state directory (XDG state directory on Linux, LocalAppData on Windows). This prevents Spectra metadata from dirtying user projects or appearing in agent patches.
