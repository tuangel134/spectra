# Spectra 1.0 production architecture

Spectra 1.0 has six release gates: deterministic build/typecheck, the complete unit/integration suite, native Rust checks, Core/Desktop E2E, state/lock stress, and security/performance budgets.

## Updates

Git installs update transactionally: Spectra fetches `origin/main`, validates the clean tree, builds and tests the new revision, and resets to the previous commit if any gate fails. Packaged installs use `update-manifest.json`, whose canonical payload is signed with Ed25519. Every selected artifact must match both the signed size and SHA-256 digest before it is activated or opened.

## Secrets

Provider and subscription credentials use macOS Keychain, Windows DPAPI, or Linux Secret Service when present. The portable fallback encrypts each item with AES-256-GCM under a random 0600 master key and is reported as a warning by production health because it is weaker than an OS keychain. Configuration files contain `{secret:...}` references instead of plaintext keys.

## Recovery

The Core writes a per-project crash marker outside the repository, keyed by a non-reversible project hash. Clean shutdowns mark the record complete; stale unclean records are exposed through the production API and Desktop readiness panel.

## Supply chain

Tag releases build platform packages with cargo-packager, produce an SPDX 2.3 SBOM and SHA256SUMS, sign the update manifest with the repository Ed25519 release key, keyless-sign every artifact with Sigstore/cosign, and publish GitHub build provenance.
