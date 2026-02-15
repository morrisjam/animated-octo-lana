interface SloAlert {
  code: string;
  severity: 'critical' | 'warning';
  message: string;
  escalation: string;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep raw text body for diagnostics when not JSON.
  }
  return {
    status: response.status,
    body,
  };
}

async function run(): Promise<void> {
  const baseUrl = String(process.env.API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('API_BASE_URL is required.');
  }
  const windowHours = parsePositiveInteger(process.env.DEPLOY_HEALTHCHECK_WINDOW_HOURS, 1);
  const maxCriticalAlerts = parsePositiveInteger(process.env.DEPLOY_MAX_CRITICAL_ALERTS, 0);
  const maxWarningAlerts = parsePositiveInteger(process.env.DEPLOY_MAX_WARNING_ALERTS, 1);

  const health = await fetchJson(`${baseUrl}/health`);
  if (health.status !== 200 || typeof health.body !== 'object' || health.body === null || !('ok' in health.body)) {
    throw new Error(`Health endpoint failed: status=${health.status}`);
  }
  const queueConfig = await fetchJson(`${baseUrl}/matchmaking/queue/config`);
  if (queueConfig.status !== 200) {
    throw new Error(`Queue config endpoint failed: status=${queueConfig.status}`);
  }

  let criticalAlerts = 0;
  let warningAlerts = 0;
  const apiSloAdminKey = String(process.env.API_SLO_ADMIN_KEY ?? '').trim();
  let sloSummaryFetched = false;
  if (apiSloAdminKey) {
    const slo = await fetchJson(`${baseUrl}/ops/slo/summary?windowHours=${windowHours}`, {
      headers: {
        'x-admin-key': apiSloAdminKey,
      },
    });
    if (slo.status === 200 && typeof slo.body === 'object' && slo.body !== null) {
      const alerts = Array.isArray((slo.body as { alerts?: unknown }).alerts)
        ? ((slo.body as { alerts: SloAlert[] }).alerts ?? [])
        : [];
      criticalAlerts = alerts.filter((alert) => alert.severity === 'critical').length;
      warningAlerts = alerts.filter((alert) => alert.severity === 'warning').length;
      sloSummaryFetched = true;
      if (criticalAlerts > maxCriticalAlerts || warningAlerts > maxWarningAlerts) {
        throw new Error(
          `SLO alert threshold exceeded (critical=${criticalAlerts}/${maxCriticalAlerts}, warning=${warningAlerts}/${maxWarningAlerts}).`,
        );
      }
    } else {
      throw new Error(`Failed to read SLO summary: status=${slo.status}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checks: {
          healthStatus: health.status,
          queueConfigStatus: queueConfig.status,
          sloSummaryFetched,
          criticalAlerts,
          warningAlerts,
          windowHours,
        },
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
