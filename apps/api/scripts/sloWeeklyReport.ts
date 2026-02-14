import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { deriveSloSummary, evaluateSloAlerts } from '../src/ops/sloPolicy';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, '../../../.env') });

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parsePercentage(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    return null;
  }
  return parsed;
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for SLO weekly report.');
  }
  const availabilityTarget = parsePercentage(process.env.SLO_AVAILABILITY_TARGET_PERCENT) ?? 99.5;
  const errorRateTarget = parsePercentage(process.env.SLO_ERROR_RATE_TARGET_PERCENT) ?? 1;
  const latencyTarget = parsePositiveInt(process.env.SLO_LATENCY_P95_TARGET_MS) ?? 350;
  const windowDays = parsePositiveInt(process.env.SLO_REPORT_WINDOW_DAYS) ?? 7;
  const windowHours = windowDays * 24;

  const pool = new Pool({ connectionString });
  try {
    const summaryResult = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS total_requests,
        COUNT(*) FILTER (WHERE status_code < 500)::bigint AS success_requests,
        COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS error_requests,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS latency_p95_ms
      FROM service_slo_request_samples
      WHERE sampled_at >= NOW() - make_interval(hours => $1::int)
      `,
      [windowHours],
    );
    const summaryRow = summaryResult.rows[0] as {
      total_requests: string;
      success_requests: string;
      error_requests: string;
      latency_p95_ms: number | string | null;
    };
    const summary = deriveSloSummary(
      Number(summaryRow.total_requests ?? '0'),
      Number(summaryRow.success_requests ?? '0'),
      Number(summaryRow.error_requests ?? '0'),
      summaryRow.latency_p95_ms === null ? null : Number(summaryRow.latency_p95_ms),
    );

    const routeRows = await pool.query(
      `
      SELECT
        method,
        route,
        COUNT(*)::bigint AS total_requests,
        COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS error_requests,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS latency_p95_ms
      FROM service_slo_request_samples
      WHERE sampled_at >= NOW() - make_interval(hours => $1::int)
      GROUP BY method, route
      ORDER BY total_requests DESC
      LIMIT 10
      `,
      [windowHours],
    );

    const alerts = evaluateSloAlerts(summary, {
      availabilityPercent: availabilityTarget,
      errorRatePercent: errorRateTarget,
      latencyP95Ms: latencyTarget,
    });

    const reportDate = new Date().toISOString().slice(0, 10);
    const outputDir = path.resolve(currentDir, '../../../docs/reports');
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `slo-weekly-${reportDate}.md`);
    const lines: string[] = [];
    lines.push(`# Weekly SLO Report (${reportDate})`);
    lines.push('');
    lines.push(`Window: last ${windowDays} day(s)`);
    lines.push('');
    lines.push('## Targets');
    lines.push(`- Availability >= ${availabilityTarget}%`);
    lines.push(`- Error rate <= ${errorRateTarget}%`);
    lines.push(`- Latency p95 <= ${latencyTarget}ms`);
    lines.push('');
    lines.push('## Observed');
    lines.push(`- Total requests: ${summary.totalRequests}`);
    lines.push(`- Success requests: ${summary.successRequests}`);
    lines.push(`- Error requests: ${summary.errorRequests}`);
    lines.push(`- Availability: ${summary.availabilityPercent}%`);
    lines.push(`- Error rate: ${summary.errorRatePercent}%`);
    lines.push(`- Latency p95: ${summary.latencyP95Ms ?? 'n/a'}ms`);
    lines.push('');
    lines.push('## Alerts');
    if (alerts.length === 0) {
      lines.push('- No SLO alerts triggered.');
    } else {
      for (const alert of alerts) {
        lines.push(`- [${alert.severity}] ${alert.code}: ${alert.message} Escalation=${alert.escalation}.`);
      }
    }
    lines.push('');
    lines.push('## Top Routes (by volume)');
    if (routeRows.rowCount) {
      for (const row of routeRows.rows as Array<{
        method: string;
        route: string;
        total_requests: string;
        error_requests: string;
        latency_p95_ms: number | string | null;
      }>) {
        lines.push(
          `- ${row.method} ${row.route}: total=${Number(row.total_requests)}, errors=${Number(row.error_requests)}, p95=${
            row.latency_p95_ms === null ? 'n/a' : Math.round(Number(row.latency_p95_ms))
          }ms`,
        );
      }
    } else {
      lines.push('- No samples recorded for this window.');
    }
    lines.push('');
    await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
    console.log(`Wrote ${outputPath}`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
