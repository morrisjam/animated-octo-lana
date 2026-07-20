import { describe, expect, test } from 'vitest';
import { createReleaseNetworkSoakEvidence, sha256Hex } from './releaseNetworkSoakEvidence';

const RELEASE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';

function createReport(forceRelay: boolean) {
  return {
    schemaVersion: 'gw.webrtc-browser-smoke.v8',
    ok: true,
    forceRelayRequested: forceRelay,
    expectedReleaseSha: RELEASE_SHA,
    connectionPaths: [forceRelay ? 'relay' : 'direct', forceRelay ? 'relay' : 'direct'],
    iceTransportPolicies: [forceRelay ? 'relay' : 'all', forceRelay ? 'relay' : 'all'],
    turnCredentialModes: [
      forceRelay ? 'time_limited' : 'time_limited',
      forceRelay ? 'time_limited' : 'time_limited',
    ],
    recovery: {
      connectionPaths: [forceRelay ? 'relay' : 'direct', forceRelay ? 'relay' : 'direct'],
    },
    twoClient: {
      schemaVersion: 'gw.webrtc-two-client-smoke.v5',
      forceRelayRequested: forceRelay,
      buildVersion: RELEASE_SHA,
      connectionPaths: [forceRelay ? 'relay' : 'direct', forceRelay ? 'relay' : 'direct'],
      iceTransportPolicies: [forceRelay ? 'relay' : 'all', forceRelay ? 'relay' : 'all'],
      turnCredentialModes: [
        forceRelay ? 'time_limited' : 'none',
        forceRelay ? 'time_limited' : 'none',
      ],
      rollbackSoak: {
        schemaVersion: 'gw.webrtc-two-client-rollback-soak.v1',
        passed: true,
        requestedDurationSeconds: 1_800,
        observedDurationSeconds: 1_799,
        durationRatio: 0.9994,
        thresholds: { maxRollbackDepthFrames: 30 },
        rollback: {
          peers: {
            P1: { rollback: { maxRollbackDepth: 12 } },
            P2: { rollback: { maxRollbackDepth: 10 } },
          },
        },
        failures: [],
      },
    },
  };
}

describe('release network soak evidence', () => {
  test('binds 30-minute direct and relay reports to one web release', () => {
    const evidence = createReleaseNetworkSoakEvidence({
      expectedReleaseSha: RELEASE_SHA,
      workflowRunId: '12345',
      webAttestation: { schemaVersion: 'gw.web-release.v1', releaseSha: RELEASE_SHA },
      directReport: createReport(false),
      directReportSha256: sha256Hex('direct'),
      relayReport: createReport(true),
      relayReportSha256: sha256Hex('relay'),
    });
    expect(evidence).toMatchObject({
      schemaVersion: 'gw.release-network-soak.v1',
      releaseSha: RELEASE_SHA,
      localInfrastructureOnly: true,
      hostedApplicationServicesContacted: false,
      crossNetwork: false,
      profiles: {
        direct: { requestedDurationSeconds: 1_800, connectionPaths: ['direct', 'direct'] },
        relay: {
          requestedDurationSeconds: 1_800,
          allowedMaxRollbackDepthFrames: 30,
          maxRollbackDepthFrames: 12,
          connectionPaths: ['relay', 'relay'],
        },
      },
    });
  });

  test('rejects short, wrong-build, or non-relay evidence', () => {
    const mutations = [
      (report: ReturnType<typeof createReport>) => {
        report.twoClient.rollbackSoak.requestedDurationSeconds = 1;
      },
      (report: ReturnType<typeof createReport>) => {
        report.twoClient.buildVersion = '1'.repeat(40);
      },
      (report: ReturnType<typeof createReport>) => {
        report.twoClient.connectionPaths = ['direct', 'direct'];
      },
    ];
    for (const mutate of mutations) {
      const relayReport = createReport(true);
      mutate(relayReport);
      expect(() => createReleaseNetworkSoakEvidence({
        expectedReleaseSha: RELEASE_SHA,
        workflowRunId: '12345',
        webAttestation: { schemaVersion: 'gw.web-release.v1', releaseSha: RELEASE_SHA },
        directReport: createReport(false),
        directReportSha256: sha256Hex('direct'),
        relayReport,
        relayReportSha256: sha256Hex('relay'),
      })).toThrow();
    }
  });
});
