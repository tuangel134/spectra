# Spectra Desktop IDE

Spectra Desktop is the primary product surface. It connects to the persistent
Spectra Core and combines the agent with a guarded project workspace.

## Workspace

- Hierarchical file explorer with search and quick-open.
- Tabbed text editor with dirty state, line numbers, keyboard shortcuts, atomic
  saves, and language detection.
- Agent chat remains visible in the right-hand pane.
- Bottom panel for terminal commands, LSP diagnostics, Git diffs, and output.
- Visual spec browser and editable requirements, design, and task documents.

## Security boundaries

The Desktop webview does not receive direct filesystem or process access.
Every operation goes through the authenticated local Core API.

- Paths are resolved beneath the active project and symlinks are not followed
  by the explorer.
- Editor saves use the active `edit` permission and atomic replacement.
- Terminal commands use the existing `bash` tool and security profile.
- Commands and saves that resolve to `ask` require explicit confirmation.
- Git status and diff use argv-based process execution without a shell.
- Files larger than 2 MiB and likely-binary files are rejected by the editor.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+P` | Quick open |
| `Ctrl/Cmd+Shift+P` | Command palette |
| `Ctrl/Cmd+S` | Save active document |
| `Ctrl+`` | Open terminal |

The TUI, shared web UI, and VS Code integration continue to use the same Core.
