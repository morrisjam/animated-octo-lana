export interface SloTargets {
  availabilityPercent: number;
  errorRatePercent: number;
  latencyP95Ms: number;
}

export interface SloSummary {
  totalRequests: number;
  successRequests: number;
  errorRequests: number;
  availabilityPercent: number;
  errorRatePercent: number;
  latencyP95Ms: number | null;
}

export interface SloAlert {
  code: 'availability_breach' | 'error_rate_breach' | 'latency_p95_breach';
  severity: 'critical' | 'warning';
  message: string;
  escalation: 'on_call_immediate' | 'business_hours';
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function deriveSloSummary(
  totalRequests: number,
  successRequests: number,
  errorRequests: number,
  latencyP95Ms: number | null,
): SloSummary {
  const safeTotal = Math.max(0, Math.floor(totalRequests));
  const safeSuccess = Math.max(0, Math.floor(successRequests));
  const safeErrors = Math.max(0, Math.floor(errorRequests));
  const availabilityPercent = safeTotal > 0 ? (safeSuccess / safeTotal) * 100 : 100;
  const errorRatePercent = safeTotal > 0 ? (safeErrors / safeTotal) * 100 : 0;
  return {
    totalRequests: safeTotal,
    successRequests: safeSuccess,
    errorRequests: safeErrors,
    availabilityPercent: roundToTwo(availabilityPercent),
    errorRatePercent: roundToTwo(errorRatePercent),
    latencyP95Ms: latencyP95Ms === null ? null : Math.round(latencyP95Ms),
  };
}

export function evaluateSloAlerts(summary: SloSummary, targets: SloTargets): SloAlert[] {
  const alerts: SloAlert[] = [];
  if (summary.availabilityPercent < targets.availabilityPercent) {
    alerts.push({
      code: 'availability_breach',
      severity: 'critical',
      escalation: 'on_call_immediate',
      message: `Availability ${summary.availabilityPercent}% below target ${targets.availabilityPercent}%.`,
    });
  }
  if (summary.errorRatePercent > targets.errorRatePercent) {
    alerts.push({
      code: 'error_rate_breach',
      severity: 'critical',
      escalation: 'on_call_immediate',
      message: `Error rate ${summary.errorRatePercent}% above target ${targets.errorRatePercent}%.`,
    });
  }
  if (summary.latencyP95Ms !== null && summary.latencyP95Ms > targets.latencyP95Ms) {
    alerts.push({
      code: 'latency_p95_breach',
      severity: 'warning',
      escalation: 'business_hours',
      message: `Latency p95 ${summary.latencyP95Ms}ms above target ${targets.latencyP95Ms}ms.`,
    });
  }
  return alerts;
}
