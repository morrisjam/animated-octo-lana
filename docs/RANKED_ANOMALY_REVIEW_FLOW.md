# Ranked Anomaly Review Flow

Date: 2026-02-14  
Status: active

## Purpose
- Provide a consistent operations flow for ranked anomaly alerts.
- Ensure false positives are recorded with rationale.

## Alert Sources
- `impossible_cadence`: ranked matches submitted too quickly for one account.
- `rating_jump`: per-match rating delta exceeds configured threshold.
- `mr_jump`: per-match MR delta exceeds configured threshold.

## Configuration
- `RANKED_ANOMALY_MIN_MATCH_INTERVAL_SECONDS` (default `30`)
- `RANKED_ANOMALY_RATING_JUMP_THRESHOLD` (default `60`)
- `RANKED_ANOMALY_MR_JUMP_THRESHOLD` (default `80`)
- `RANKED_ANOMALY_ADMIN_KEY` (required for review endpoints)

## Triage Steps
1. Query open alerts:
   - `GET /ranked/anomalies/alerts?status=open`
   - Header: `x-admin-key: <RANKED_ANOMALY_ADMIN_KEY>`
2. Inspect evidence:
   - `accountId`, `matchId`, `message`, `metadata`, `detectedAt`
   - Validate context against progression, replay, and matchmaking diagnostics.
3. Record decision:
   - Confirmed abuse:
     - `POST /ranked/anomalies/alerts/:alertId/review`
     - Body: `{ "status": "confirmed", "note": "concise evidence summary" }`
   - False positive:
     - `POST /ranked/anomalies/alerts/:alertId/review`
     - Body: `{ "status": "false_positive", "note": "required dismissal reason" }`
   - Optional reviewer attribution header: `x-admin-actor: <operator-id>`

## Response and Audit
- Alert rows persist:
  - `status`: `open`, `false_positive`, `confirmed`
  - `reviewed_at`, `reviewed_by`, `review_note`
- Notes are mandatory for `false_positive` decisions.
- Use `confirmed` alerts as inputs to containment/enforcement workflows in anti-smurf policy.
