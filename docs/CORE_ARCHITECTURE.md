# Spectra Core architecture

Spectra Desktop, the TUI, the web surface, and editor integrations share a versioned Core process.

## Lifecycle

1. `spectra desktop` looks for a healthy Core lease for the current project.
2. If a compatible Core exists, Desktop reconnects to it.
3. Otherwise, the supervisor starts `spectra core-daemon` on loopback.
4. The daemon owns the runtime, sessions, MCP/LSP integrations, and HTTP API.
5. Closing the Desktop window only detaches the client. The Core remains available so active and resumable work is not lost.
6. Switching projects transfers the lease and journal to the active workspace, preventing one project from accidentally reusing another project's runtime.
7. `spectra core stop` performs a controlled shutdown and flushes sessions.

## Protocol

`CORE_PROTOCOL_VERSION` is returned by `/health` and `/api/core/status`. Clients must reject incompatible future or legacy protocols rather than guessing.

## Persistence

The Core event journal uses `node:sqlite` with WAL when it is available. Node versions without the built-in SQLite module use an atomic JSON metadata file plus an append-only JSONL journal. Existing Spectra session and autorun persistence continue to work and are surfaced together in the recovery summary.

State is stored under `.spectra/state/` and should not be committed.

## Security

- Core binds only to `127.0.0.1`.
- The existing per-launch bearer token remains required for API requests.
- Lease files contain no API token.
- Lease files live in the user's Spectra configuration directory with restrictive permissions.
- Desktop validates the protocol and instance identity before reuse.

## Commands

```bash
spectra core status
spectra core start
spectra core stop
spectra core restart
```
