# Steam Build Profile And Packaging

Story: `S1.2` Steam build profile and packaging

## Goal

Produce a Steam-ready client artifact from CI with an integrity signature, no CDN dependency for core gameplay assets, and a local launch smoke check.

## Build profile

- File: root `.env.steam`
- Applied by: `vite build --mode steam`
- Key defaults:
  - `VITE_PLATFORM=steam`
  - online/ranked/diagnostics/dev-menu flags disabled
  - training and arcade flags enabled

This keeps core gameplay available without requiring online APIs at runtime.

## Packaging

Command:

```bash
npm run steam:package
```

Output directory:

- `apps/game-web/steam-artifact/content/` static game files
- `apps/game-web/steam-artifact/manifest.json`
- `apps/game-web/steam-artifact/checksums.sha256`
- `apps/game-web/steam-artifact/checksums.sha256.sig`
- `apps/game-web/steam-artifact/signing-public-key.pem`
- optional `apps/game-web/steam-artifact/steam_appid.txt` when `STEAM_APP_ID` is set

Signing behavior:

- If `STEAM_ARTIFACT_SIGNING_KEY` is set, the checksum manifest is signed with that key.
- If not set, CI generates an ephemeral RSA key and still emits a signed package.
- `STEAM_ARTIFACT_SIGNING_PUBLIC_KEY` is optional; when omitted, public key is derived from the signing key.

## Smoke launch test

Command:

```bash
npm run steam:smoke
```

Checks:

- Packaged `index.html` exists and includes script/stylesheet assets.
- Asset references are local (no `http(s)` or protocol-relative CDN references).
- Package can be served and loaded from a local static server.

## CI integration

Workflow: `.github/workflows/ci.yml` (`steam-package` job)

1. `npm run steam:ci` (`build -> package -> smoke`)
2. tarball creation: `steam-artifacts/gravity-well-steam-${GITHUB_SHA}.tar.gz`
3. upload artifact: `steam-package-${GITHUB_SHA}`

Optional GitHub repository secrets for stable signing:

- `STEAM_ARTIFACT_SIGNING_KEY`
- `STEAM_ARTIFACT_SIGNING_PUBLIC_KEY`
- `STEAM_APP_ID`
