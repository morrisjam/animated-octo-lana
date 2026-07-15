# Steam Build Profile And Native Packaging

Story: `S1.2` Steam build profile and packaging

## Goal

Produce a Windows Steam client that hosts the local web build in a sandboxed Electron renderer, obtains genuine Steam Web API tickets in the native main process, and contains no remote executable asset dependency.

## Build profile

The root `.env.steam` is loaded through Vite's configured root `envDir`.

- `VITE_PLATFORM=steam`
- `VITE_PROFILE_API_BASE=https://api.gravitywell.space`
- `VITE_STEAM_WEB_API_IDENTITY=gravity-well-api`
- Public online, ranked, online runtime, diagnostics, and developer-menu flags remain disabled until the controlled-alpha gates pass.
- Training and arcade remain enabled.

The identity is public routing metadata and must exactly match `STEAM_WEB_API_IDENTITY` on the API. The publisher API key remains server-only.

## Native package

The native shell lives outside the root npm workspaces so ordinary API/web installs do not download Electron or Steam binaries.

```bash
npm ci --prefix apps/steam-shell
npm run steam:native:ci
```

The command builds the Steam web profile, runs native ticket-broker tests, stages the local web files, packages a Windows x64 Electron application, copies the required Steamworks redistributable, strips non-runtime package dependencies, and checks the artifact structure.

Output:

- `apps/steam-shell/release/GravityWell-win32-x64/GravityWell.exe`
- `apps/steam-shell/release/GravityWell-win32-x64/steam_api64.dll`
- local renderer files under `resources/app/web`
- `steamworks.js` native binding under `resources/app/node_modules`

The artifact smoke test fails if any other application dependency remains under packaged `node_modules`, if the Windows Steamworks binding is missing, or if a development ticket or `steam_appid.txt` leaks into the package. The package and smoke checks passed locally on 2026-07-14 without contacting the hosted API or Neon.

The production artifact must not include `steam_appid.txt`. For a local Spacewar or partner-AppID test only:

```powershell
$env:STEAM_APP_ID = '480'
$env:STEAM_INCLUDE_APP_ID_FILE = 'true'
npm run steam:native:package
```

## Security boundary

- Steamworks and native ticket handles exist only in the Electron main process.
- Renderer `nodeIntegration` is disabled, `contextIsolation` and sandboxing are enabled, permissions and new windows are denied, and navigation is restricted to the packaged entry document.
- Preload exposes narrow ticket lifecycle and packaged auth-exchange methods rather than raw `ipcRenderer`.
- Every IPC call verifies its BrowserWindow and document sender.
- Tickets are identity-bound, converted from callback-complete bytes to hex, claimed once for API exchange in the main process, and then cancelled.
- The `file://` renderer never performs the cross-origin Steam exchange; its auth request is routed through IPC to the exact packaged HTTPS API endpoint, redirects are rejected, and response headers and streaming body size are bounded before returning to the renderer.
- The API independently validates the ticket with Steam and issues a signed Gravity Well session.

## CI integration

`.github/workflows/ci.yml` runs the native Steam package job on Windows after the main verification job. The uploaded artifact is the packaged Windows directory, not the former static-site bundle.

An actual Steam client/AppID rehearsal remains a release gate because CI cannot prove Steam account ownership without partner credentials and a running Steam session. The current local artifact is also unsigned; production Authenticode signing and verification are required before alpha distribution.
