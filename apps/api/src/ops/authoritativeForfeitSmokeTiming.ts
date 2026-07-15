const DEFAULT_SCHEDULER_CUSHION_MS = 5_000;

interface LivenessResolutionTimeoutOptions {
  configuredMinimumMs: number;
  heartbeatTimeoutSeconds: number;
  reconnectGraceSeconds: number;
  schedulerCushionMs?: number;
}

function requireNonNegativeFinite(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
  return value;
}

export function deriveLivenessResolutionTimeoutMs(
  options: LivenessResolutionTimeoutOptions,
): number {
  const configuredMinimumMs = requireNonNegativeFinite(
    'configuredMinimumMs',
    options.configuredMinimumMs,
  );
  const heartbeatTimeoutSeconds = requireNonNegativeFinite(
    'heartbeatTimeoutSeconds',
    options.heartbeatTimeoutSeconds,
  );
  const reconnectGraceSeconds = requireNonNegativeFinite(
    'reconnectGraceSeconds',
    options.reconnectGraceSeconds,
  );
  const schedulerCushionMs = requireNonNegativeFinite(
    'schedulerCushionMs',
    options.schedulerCushionMs ?? DEFAULT_SCHEDULER_CUSHION_MS,
  );
  const advertisedLivenessWindowMs = (
    heartbeatTimeoutSeconds + reconnectGraceSeconds
  ) * 1_000;
  return Math.ceil(Math.max(
    configuredMinimumMs,
    advertisedLivenessWindowMs + schedulerCushionMs,
  ));
}
