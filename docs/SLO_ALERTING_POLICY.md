# SLO And Alerting Policy

Date: 2026-02-14  
Status: active

## SLO Definitions
- Availability SLO:
  - Target: `>= 99.5%`
  - Calculation: `successful requests (status < 500) / total requests` over rolling window.
- Error-rate SLO:
  - Target: `<= 1.0%`
  - Calculation: `5xx requests / total requests` over rolling window.
- Latency SLO:
  - Target: `p95 <= 350ms`
  - Calculation: p95 of `latency_ms` from request samples over rolling window.

Environment overrides:
- `SLO_AVAILABILITY_TARGET_PERCENT`
- `SLO_ERROR_RATE_TARGET_PERCENT`
- `SLO_LATENCY_P95_TARGET_MS`

## Alert Rules
- `availability_breach`:
  - Condition: availability below target.
  - Severity: `critical`
  - Escalation: `on_call_immediate`
- `error_rate_breach`:
  - Condition: error rate above target.
  - Severity: `critical`
  - Escalation: `on_call_immediate`
- `latency_p95_breach`:
  - Condition: p95 latency above target.
  - Severity: `warning`
  - Escalation: `business_hours`

Runtime API:
- `GET /ops/slo/summary?windowHours=168`
- Header: `x-admin-key: <SLO_ADMIN_KEY>`

## Escalation Policy
- `on_call_immediate`:
  - Page primary on-call.
  - Open incident channel and assign incident commander.
  - Start mitigation/rollback path if user-impacting.
- `business_hours`:
  - Create operations ticket with route-level evidence.
  - Prioritise in next ops/engineering standup.
  - Promote to immediate paging if warning persists > 24 hours.

## Weekly Report Automation
- Command: `npm run api:slo-report`
- Output: `docs/reports/slo-weekly-YYYY-MM-DD.md`
- Recommended schedule:
  - Run every Monday 09:00 UTC using a platform cron job.
  - Example (Render cron job command): `npm run api:slo-report`

## Data Source
- Request samples table: `service_slo_request_samples`.
- Samples are recorded from API request/response hooks.
