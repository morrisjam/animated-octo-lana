# Deployment Runbook

Last updated: 2026-02-14

## Live stack inventory

| Area | Provider | Service/Project | Live endpoint |
| --- | --- | --- | --- |
| Web client | Cloudflare Pages | `animated-octo-lana` | `https://play.gravitywell.space` |
| Web fallback | Cloudflare Pages | `animated-octo-lana` | `https://animated-octo-lana.pages.dev` |
| API | Render | Web service `gravity-well` | `https://api.gravitywell.space` |
| API fallback | Render | Web service `gravity-well` | `https://gravity-well.onrender.com` |
| Primary DB | Neon (AWS region) | Postgres | via `DATABASE_URL` secret |
| DNS + TLS | Cloudflare | Zone `gravitywell.space` | manages DNS records and certs |
| Domain registrar | GoDaddy | `gravitywell.space` | registrar only |
| Source control | GitHub | `morrisjam/animated-octo-lana` | `master` production branch |

## DNS records currently in use

Managed in Cloudflare DNS for `gravitywell.space`:

- `CNAME play -> animated-octo-lana.pages.dev`
- `CNAME api -> gravity-well.onrender.com`

Notes:

- Keep `api` as `DNS only` during Render verification/certificate setup.
- Do not edit DNS in GoDaddy while Cloudflare nameservers are authoritative.

## Cloudflare Pages config

Project: `animated-octo-lana`

- Root directory: blank (repo root)
- Build command: `npm run build`
- Build output directory: `apps/game-web/dist`
- Production branch: `master`
- Node: `22`

### Pages production variables

```env
NODE_VERSION=22
VITE_APP_ENV=production
VITE_PLATFORM=web
VITE_PROFILE_API_BASE=https://api.gravitywell.space
VITE_MATCHMAKING_API_BASE=https://api.gravitywell.space
VITE_FEATURE_ONLINE=true
VITE_FEATURE_RANKED=true
VITE_FEATURE_DEBUG_TOOLS=false
VITE_FEATURE_TRAINING_MODE=true
VITE_FEATURE_ARCADE_MODE=false
```

## Render API config

Service: `gravity-well` (Web Service)

- Branch: `master`
- Build command: `npm ci`
- Start command: `npm run api:dev`
- Health check path: `/health`
- Auto-deploy: `On Commit`
- Suggested plan: `Starter`

### Render environment variables

```env
DATABASE_URL=<neon_connection_string>
API_CORS_ORIGINS=https://play.gravitywell.space
ROOM_WEB_INVITE_BASE_URL=https://play.gravitywell.space
REPLAY_BLOB_PROVIDER=local
REPLAY_BLOB_DIR=./data/replay-blobs
```

Do not use quotes around values unless needed by provider UI.

## Secrets policy

- Never commit `.env` with live secrets.
- `.env` is ignored in git (`.gitignore`).
- Keep production secrets only in provider secret managers (Render/Cloudflare).
- If a secret is accidentally exposed, rotate it immediately.

## Deployment flow

1. Push to `master`.
2. Render auto-deploys API from the commit.
3. Cloudflare Pages auto-builds/deploys web from the commit.
4. Validate:
   - `https://api.gravitywell.space/health` returns `{ "ok": true }`
   - `https://play.gravitywell.space` loads and can create profile/session.

## Quick troubleshooting

- `root directory not found` in Pages:
  - Root directory was set to a non-existent path. Set it blank.
- `Missing entry-point to Worker script` in Cloudflare build:
  - Worker deploy command was used for Pages. Remove `wrangler deploy` from deploy command.
- API returns `ENOTFOUND base`:
  - `DATABASE_URL` was malformed (copied with `psql` wrapper). Use raw URL only.
- Browser CORS preflight fails for `PUT /profile`:
  - Ensure API includes CORS methods including `PUT` (fixed in `master`).
- Render domain verify/cert pending:
  - Ensure `api` CNAME exists and uses `DNS only` in Cloudflare while verifying.
