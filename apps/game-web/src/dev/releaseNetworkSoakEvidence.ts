import { createHash } from 'node:crypto';

export const RELEASE_NETWORK_SOAK_SCHEMA_VERSION = 'gw.release-network-soak.v1' as const;

interface SoakProfileEvidence {
  reportSha256: string;
  requestedDurationSeconds: number;
  observedDurationSeconds: number;
  durationRatio: number;
  allowedMaxRollbackDepthFrames: number;
  maxRollbackDepthFrames: number;
  connectionPaths: string[];
}

export interface ReleaseNetworkSoakEvidence {
  schemaVersion: typeof RELEASE_NETWORK_SOAK_SCHEMA_VERSION;
  releaseSha: string;
  workflowRunId: string;
  localInfrastructureOnly: true;
  hostedApplicationServicesContacted: false;
  crossNetwork: false;
  profiles: {
    direct: SoakProfileEvidence;
    relay: SoakProfileEvidence;
  };
}

const EXACT_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function validateProfile(
  value: unknown,
  expectedReleaseSha: string,
  expectedRelay: boolean,
  reportSha256: string,
): SoakProfileEvidence {
  if (!SHA256_PATTERN.test(reportSha256)) {
    throw new Error('Network soak report digest must be SHA-256.');
  }
  const report = requireObject(value, 'Network soak report');
  const twoClient = requireObject(report.twoClient, 'Network soak two-client phase');
  const soak = requireObject(twoClient.rollbackSoak, 'Network soak rollback phase');
  const thresholds = requireObject(soak.thresholds, 'Network soak thresholds');
  const recovery = requireObject(report.recovery, 'Network soak recovery phase');
  const rollback = requireObject(soak.rollback, 'Network soak rollback result');
  const peers = requireObject(rollback.peers, 'Network soak rollback peers');
  const p1Rollback = requireObject(
    requireObject(peers.P1, 'Network soak P1 rollback peer').rollback,
    'Network soak P1 rollback diagnostics',
  );
  const p2Rollback = requireObject(
    requireObject(peers.P2, 'Network soak P2 rollback peer').rollback,
    'Network soak P2 rollback diagnostics',
  );
  const connectionPaths = Array.isArray(twoClient.connectionPaths)
    ? twoClient.connectionPaths.map(String)
    : [];
  const primaryConnectionPaths = Array.isArray(report.connectionPaths)
    ? report.connectionPaths.map(String)
    : [];
  const recoveryConnectionPaths = Array.isArray(recovery.connectionPaths)
    ? recovery.connectionPaths.map(String)
    : [];
  const requestedDurationSeconds = Number(soak.requestedDurationSeconds);
  const observedDurationSeconds = Number(soak.observedDurationSeconds);
  const durationRatio = Number(soak.durationRatio);
  const allowedMaxRollbackDepthFrames = Number(thresholds.maxRollbackDepthFrames);
  const maxRollbackDepthFrames = Math.max(
    Number(p1Rollback.maxRollbackDepth),
    Number(p2Rollback.maxRollbackDepth),
  );
  const expectedPath = expectedRelay ? 'relay' : 'direct';
  if (
    report.schemaVersion !== 'gw.webrtc-browser-smoke.v8'
    || report.ok !== true
    || report.forceRelayRequested !== expectedRelay
    || String(report.expectedReleaseSha).toLowerCase() !== expectedReleaseSha
    || twoClient.schemaVersion !== 'gw.webrtc-two-client-smoke.v5'
    || twoClient.forceRelayRequested !== expectedRelay
    || String(twoClient.buildVersion).toLowerCase() !== expectedReleaseSha
    || soak.schemaVersion !== 'gw.webrtc-two-client-rollback-soak.v1'
    || soak.passed !== true
    || !Array.isArray(soak.failures)
    || soak.failures.length !== 0
    || requestedDurationSeconds < 1_800
    || observedDurationSeconds < requestedDurationSeconds * 0.95
    || durationRatio < 0.95
    || Math.abs(durationRatio - observedDurationSeconds / requestedDurationSeconds) > 0.01
    || !Number.isSafeInteger(allowedMaxRollbackDepthFrames)
    || allowedMaxRollbackDepthFrames < 1
    || !Number.isSafeInteger(maxRollbackDepthFrames)
    || maxRollbackDepthFrames < 1
    || maxRollbackDepthFrames > allowedMaxRollbackDepthFrames
    || connectionPaths.length !== 2
    || connectionPaths.some((path) => path !== expectedPath)
    || primaryConnectionPaths.length !== 2
    || primaryConnectionPaths.some((path) => path !== expectedPath)
    || recoveryConnectionPaths.length !== 2
    || recoveryConnectionPaths.some((path) => path !== expectedPath)
  ) {
    throw new Error(
      `Network soak ${expectedPath} profile does not prove the exact release for 30 real-time minutes.`,
    );
  }
  if (expectedRelay) {
    const policies = [report.iceTransportPolicies, twoClient.iceTransportPolicies]
      .flatMap((entry) => Array.isArray(entry) ? entry.map(String) : []);
    const credentialModes = [report.turnCredentialModes, twoClient.turnCredentialModes]
      .flatMap((entry) => Array.isArray(entry) ? entry.map(String) : []);
    if (
      policies.length !== 4
      || policies.some((policy) => policy !== 'relay')
      || credentialModes.length !== 4
      || credentialModes.some((mode) => mode !== 'time_limited')
    ) {
      throw new Error('Forced-relay soak did not retain relay policy and time-limited credentials.');
    }
  }
  return {
    reportSha256: reportSha256.toLowerCase(),
    requestedDurationSeconds,
    observedDurationSeconds,
    durationRatio,
    allowedMaxRollbackDepthFrames,
    maxRollbackDepthFrames,
    connectionPaths,
  };
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createReleaseNetworkSoakEvidence(input: {
  expectedReleaseSha: string;
  workflowRunId: string;
  webAttestation: unknown;
  directReport: unknown;
  directReportSha256: string;
  relayReport: unknown;
  relayReportSha256: string;
}): ReleaseNetworkSoakEvidence {
  const expectedReleaseSha = input.expectedReleaseSha.trim().toLowerCase();
  if (!EXACT_GIT_SHA_PATTERN.test(expectedReleaseSha)) {
    throw new Error('Release network soak requires an exact Git SHA.');
  }
  if (!/^\d+$/.test(input.workflowRunId.trim())) {
    throw new Error('Release network soak requires a numeric workflow run ID.');
  }
  const webAttestation = requireObject(input.webAttestation, 'Web release attestation');
  if (
    webAttestation.schemaVersion !== 'gw.web-release.v1'
    || String(webAttestation.releaseSha).toLowerCase() !== expectedReleaseSha
  ) {
    throw new Error('Web release attestation does not match the network soak release SHA.');
  }
  return {
    schemaVersion: RELEASE_NETWORK_SOAK_SCHEMA_VERSION,
    releaseSha: expectedReleaseSha,
    workflowRunId: input.workflowRunId.trim(),
    localInfrastructureOnly: true,
    hostedApplicationServicesContacted: false,
    crossNetwork: false,
    profiles: {
      direct: validateProfile(
        input.directReport,
        expectedReleaseSha,
        false,
        input.directReportSha256,
      ),
      relay: validateProfile(
        input.relayReport,
        expectedReleaseSha,
        true,
        input.relayReportSha256,
      ),
    },
  };
}
