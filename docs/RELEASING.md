# Releasing Spectra

The phase-6 installer configures the repository Actions secret `SPECTRA_UPDATE_PRIVATE_KEY_B64` without committing the private key. The matching public key is `assets/update-public-key.pem`.

A `v*` tag triggers `.github/workflows/release.yml`. The workflow validates all product gates, builds AppImage/DEB/Pacman, DMG/app, NSIS/MSI, adds the npm package, emits an SPDX SBOM and checksums, signs the manifest, adds Sigstore signatures/certificates, attaches provenance, and publishes the GitHub Release.

Never commit or print the private release key. Rotate by generating a new Ed25519 pair, updating the public key in a normal reviewed release, then replacing the Actions secret only after users have received the new trusted public key.
