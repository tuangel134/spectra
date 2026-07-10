# Spectra security model

Spectra can edit files, run commands, connect MCP servers, and load project extensions. Those capabilities are useful, but a repository is not automatically trustworthy merely because it was cloned successfully.

## Workspace Trust

Spectra Desktop fingerprints executable integration assets such as:

- `.spectra/plugins/*.js|mjs|cjs`
- `.spectra/hooks/*.json`
- `.opencode/hooks/*.json`
- `.mcp.json`, `.spectra/mcp.json`, and `.opencode/mcp.json`
- Claude settings that can define executable hooks or MCP integrations

A workspace containing none of these assets is trusted implicitly. Otherwise it opens in restricted mode until the user trusts it once or permanently. Permanent trust is tied to a SHA-256 fingerprint and is invalidated when the executable assets change.

Restricted mode blocks project hooks, JavaScript plugins, and MCP startup. Skills, specs, steering, normal source files, and model providers remain available.

## Security profiles

- **Safe** — asks before edits, commands, web access, delegation, or unknown tools.
- **Balanced** — allows normal workspace edits and web research, but supervises shell commands and delegation.
- **Autonomous** — works independently in a trusted workspace while retaining Spectra's mandatory privileged/destructive gates.
- **Unrestricted** — allows every tool. Use only in disposable or externally sandboxed environments.
- **Legacy** — preserves historical configuration for existing CLI users until they choose a profile.

Profiles are project-scoped and can be changed from Spectra Desktop.

## Reporting vulnerabilities

Do not open a public issue containing a working exploit, credential, or private repository data. Contact the maintainer privately and include the affected version, platform, reproduction steps, and expected impact.
