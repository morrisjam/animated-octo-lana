# Backup And Disaster Recovery Runbook

Date: 2026-02-15  
Status: active

## Scope
- Primary data stores:
  - PostgreSQL (`DATABASE_URL`)
  - Redis (`REDIS_URL`)
- Backup and drill automation is configured through GitHub Actions workflows.

## Targets
- RPO target: `<= 15 minutes` (`900s`)
- RTO target: `<= 60 minutes` (`3600s`)

## Automated Backups
- Workflow: `.github/workflows/ops-backups.yml`
- Schedule: daily at `02:15 UTC`
- Outputs:
  - PostgreSQL custom-format dump (`pg_dump`)
  - Redis RDB snapshot (`redis-cli --rdb`)
  - SHA256 checksums and manifest
- Artifact retention: `14 days`

Required repository secrets:
- `DATABASE_URL`
- `REDIS_URL`

## Automated Restore Drill
- Workflow: `.github/workflows/ops-restore-drill.yml`
- Schedule: weekly on Monday `09:45 UTC`
- Drill flow:
  - Seed known rows/keys into ephemeral Postgres and Redis services.
  - Perform backup snapshots for both stores.
  - Simulate loss (`dropdb`/`flushall`).
  - Restore Postgres from dump and Redis from RDB on temporary Redis instance.
  - Verify data integrity and compute observed RPO/RTO.
  - Publish markdown report artifact (`dr-restore-drill-YYYY-MM-DD.md`).

## Escalation
- If backup workflow fails:
  - Page on-call engineer.
  - Re-run workflow manually after fixing credentials or network issue.
- If restore drill exceeds targets:
  - Open incident task with root cause and mitigation owner.
  - Run follow-up drill after remediation within 72 hours.

## Manual Recovery Summary
1. Retrieve latest backup artifact.
2. Restore PostgreSQL using `pg_restore` to target database.
3. Restore Redis using `dump.rdb` and service restart or temporary instance validation.
4. Run application smoke checks.
5. Confirm data freshness against RPO target and publish recovery report.
