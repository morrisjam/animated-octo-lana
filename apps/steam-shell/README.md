# Gravity Well Steam Shell

This package is the native Steamworks host for the otherwise browser-based game client. It is intentionally outside the root npm workspaces so normal web/API installs do not download Electron or native Steam binaries.

The main process owns `steamworks.js`, waits for `getAuthTicketForWebApi(identity)`, retains each native ticket handle, and performs the Gravity Well API exchange. The context-isolated preload routes only the packaged Steam sign-in request over IPC, while ordinary web requests retain normal browser behavior. The main process accepts the configured HTTPS exchange endpoint only, refuses redirects, claims each ticket lease once, stops response streaming above 64 KiB before crossing IPC, and retains the native handle until the renderer's existing `finally` cancellation.

Local verification:

```bash
npm ci --prefix apps/steam-shell
npm test --prefix apps/steam-shell
npm run steam:alpha:build
npm run package:win --prefix apps/steam-shell
npm run smoke:win --prefix apps/steam-shell
```

`npm run steam:build` remains the offline development profile. Release packaging uses
`npm run steam:alpha:build`, which enables the allowlisted online, ranked, and live-match
runtime and emits `gw.steam-alpha-release.v1`. The native smoke requires that manifest's
API, Steam identity, ruleset, balance profile, and release profile to match this package's
own configuration. CI additionally rejects a dirty source tree or a release SHA that is not
the exact checked-out commit.

Set `STEAM_APP_ID` and `STEAM_INCLUDE_APP_ID_FILE=true` only for a local Spacewar or partner-AppID launch. A production depot must be launched through Steam and must not ship `steam_appid.txt`.

The packaged API base is `gravityWell.steamAuthApiBase` in `package.json` and must match the Steam Vite profile. Unpackaged local shell development may override it with `STEAM_AUTH_API_BASE`; only HTTPS or loopback HTTP is accepted, and packaged builds ignore that override.
