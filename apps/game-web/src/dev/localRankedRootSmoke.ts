import type { PlayerId } from '../sim/types';
import type { LocalRankedRecoverySmokeDiagnostics } from './localRankedRecoverySmoke';
import type { LocalRankedSmokeInputDriverDiagnostics } from './localRankedSmokeInputDriver';
import type { LocalRankedSmokeTransportDiagnostics } from './localRankedSmokeTransport';

export const LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION = 'gw.local-ranked-root-smoke.v5' as const;
export const LOCAL_RANKED_ROOT_SMOKE_QUERY = 'rankedRootSmoke';
export const LOCAL_RANKED_ROOT_SMOKE_SIMULATION_RATE = 8;
export const LOCAL_RANKED_ROOT_SMOKE_INBOUND_DELAY_POLLS = 1;

export interface LocalRankedRootSmokeConfig {
  enabled: boolean;
  forceRelay: boolean;
  simulationRate: number;
  inboundDelayPolls: number;
}

export interface LocalRankedRootSmokeConfigOptions {
  buildEnabled: boolean;
  url: string;
}

export interface LocalRankedRootSmokeRatingDelta {
  accountId: string;
  side: PlayerId;
  preRating: number;
  postRating: number;
  ratingDelta: number;
  result: string;
}

export interface LocalRankedRootSmokeSnapshot {
  schemaVersion: typeof LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION;
  rootPath: string;
  releaseProfile: {
    environment: string;
    buildId: string;
    rulesetVersion: string;
    balanceProfileId: string;
    onlineEnabled: boolean;
    rankedEnabled: boolean;
    onlineMatchRuntimeEnabled: boolean;
    debugToolsEnabled: boolean;
  };
  forceRelayRequested: boolean;
  phase: string;
  account: {
    accountId: string | null;
    signedAccessToken: boolean;
  };
  ticket: {
    ticketId: string;
    status: string;
    sessionId: string | null;
  } | null;
  bootstrap: {
    sessionId: string;
    status: string;
    connectionPath: string;
    detail: string;
  } | null;
  session: {
    sessionId: string;
    status: string;
    resolvedReason: string | null;
    participantAccountIds: string[];
  } | null;
  match: {
    sessionId: string;
    localAccountId: string;
    remoteAccountId: string;
    localPlayerId: PlayerId;
    remotePlayerId: PlayerId;
    connectionPath: string;
    iceTransportPolicy: string;
    relayAvailable: boolean;
    turnCredentialMode: string;
    transportAttemptGeneration: number;
    roundEpoch: number;
    simulationFrame: number;
    p1RoundWins: number;
    p2RoundWins: number;
    winner: PlayerId | null;
    finalOutcome: string | null;
    winnerAccountId: string | null;
    sessionCompletionStatus: string;
    proof: {
      claimedOutcome: string;
      roundCount: number;
      frameCount: number;
    } | null;
    inputCommitments: {
      queuedChunks: number;
      acknowledgedChunks: number;
      committedFrames: number;
      finalChainDigest: string | null;
      failed: boolean;
    } | null;
    replay: {
      status: string;
      replayId: string | null;
      digest: string | null;
      roundCount: number;
      frameCount: number;
      detail: string;
    };
    result: {
      status: string;
      submissionId: string | null;
      persistedRead: boolean;
      settlementSource: string | null;
      proofDigest: string | null;
      proofRoundCount: number | null;
      proofFrameCount: number | null;
      inputAttestation: {
        status: 'participant_verified' | 'match_verified';
        schemaVersion: string;
        minimumObservationRatio: number;
        participants: Array<{
          accountId: string;
          side: PlayerId;
          commitmentCount: number;
          committedFrameCount: number;
          finalChainDigest: string;
        }>;
      } | null;
      outcome: string | null;
      winnerAccountId: string | null;
      ratingDeltas: LocalRankedRootSmokeRatingDelta[];
      detail: string;
    };
    rollback: {
      applications: number;
      totalFrames: number;
      maxDepth: number;
      currentRoundTotalRollbacks: number;
      currentRoundCorrectionEvents: number;
    };
    inputPump: {
      outboundFrames: number;
      contiguousRemoteFrame: number;
      peerConfirmedThrough: number;
      mutuallyConfirmedThrough: number;
      uploadFailures: number;
      pollFailures: number;
      confirmationFailures: number;
    };
    recovery: LocalRankedRecoverySmokeDiagnostics | null;
    smokeTransport: LocalRankedSmokeTransportDiagnostics | null;
    driver: LocalRankedSmokeInputDriverDiagnostics | null;
  } | null;
  progression: {
    rating: number | null;
    leagueTier: string | null;
    leaguePoints: number | null;
    provisional: boolean | null;
    recentDeltas: Array<{
      result: string | null;
      preRating: number | null;
      postRating: number | null;
      occurredAt: string | null;
    }>;
  } | null;
}

export interface LocalRankedReleaseIdentityExpectation {
  buildId: string;
  rulesetVersion: string;
  balanceProfileId: string;
}

export interface LocalRankedTransportSelection {
  connectionPath: string;
  iceTransportPolicy: string;
  relayAvailable: boolean;
  forceRelay: boolean;
}

export function assertLocalRankedReleaseIdentity(
  profile: LocalRankedRootSmokeSnapshot['releaseProfile'],
  expectation: LocalRankedReleaseIdentityExpectation,
): void {
  for (const [label, actual, expected] of [
    ['build', profile.buildId, expectation.buildId],
    ['ruleset', profile.rulesetVersion, expectation.rulesetVersion],
    ['balance profile', profile.balanceProfileId, expectation.balanceProfileId],
  ] as const) {
    if (!expected.trim()) {
      throw new Error(`Expected ranked-root ${label} identity is required.`);
    }
    if (actual !== expected) {
      throw new Error(`Ranked-root ${label} identity mismatch: expected ${expected}, got ${actual}.`);
    }
  }
}

export function assertLocalRankedTransportSelection(
  selection: LocalRankedTransportSelection,
  subject = 'Ranked root transport',
): void {
  const validPath = selection.connectionPath === 'direct' || selection.connectionPath === 'relay';
  if (!validPath) {
    throw new Error(`${subject} selected invalid connection path ${selection.connectionPath}.`);
  }

  if (selection.forceRelay) {
    if (selection.connectionPath !== 'relay') {
      throw new Error(`${subject} used ${selection.connectionPath}; expected forced relay.`);
    }
    if (selection.iceTransportPolicy !== 'relay') {
      throw new Error(`${subject} used ICE policy ${selection.iceTransportPolicy}; expected relay.`);
    }
  } else if (selection.iceTransportPolicy !== 'all') {
    throw new Error(`${subject} used ICE policy ${selection.iceTransportPolicy}; expected all.`);
  }

  if (!selection.relayAvailable) {
    throw new Error(`${subject} had no release-required relay fallback.`);
  }
}

export interface LocalRankedRootSmokeBridge {
  readonly schemaVersion: typeof LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION;
  getSnapshot(): LocalRankedRootSmokeSnapshot;
  joinRankedQueue(): Promise<void>;
  refreshRankedQueue(): Promise<void>;
  armMidRoundRecovery(): Promise<void>;
  triggerMidRoundRecovery(): Promise<void>;
  refreshPersistedState(): Promise<void>;
}

interface LocalRankedRootSmokeWindow {
  __gravityWellLocalRankedRootSmoke?: LocalRankedRootSmokeBridge;
}

declare global {
  interface Window extends LocalRankedRootSmokeWindow {}
}

function parseQueryFlag(searchParams: URLSearchParams, name: string): boolean {
  const raw = searchParams.get(name);
  if (raw === null || raw === '0') {
    return false;
  }
  if (raw === '1') {
    return true;
  }
  throw new Error(`${name} must be 1 or 0.`);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function resolveLocalRankedRootSmokeConfig(
  options: LocalRankedRootSmokeConfigOptions,
): LocalRankedRootSmokeConfig {
  const url = new URL(options.url);
  const requested = parseQueryFlag(url.searchParams, LOCAL_RANKED_ROOT_SMOKE_QUERY);
  const forceRelay = parseQueryFlag(url.searchParams, 'forceRelay');
  if (!requested) {
    if (forceRelay) {
      throw new Error('forceRelay only accepted by local ranked smoke.');
    }
    return {
      enabled: false,
      forceRelay: false,
      simulationRate: 1,
      inboundDelayPolls: 0,
    };
  }
  if (!options.buildEnabled) {
    throw new Error('Build does not include local ranked smoke.');
  }
  if (url.protocol !== 'http:' || !isLoopbackHostname(url.hostname)) {
    throw new Error('Local smoke requires an HTTP loopback origin.');
  }
  if (url.pathname !== '/') {
    throw new Error('Local smoke requires the application root.');
  }
  return {
    enabled: true,
    forceRelay,
    simulationRate: LOCAL_RANKED_ROOT_SMOKE_SIMULATION_RATE,
    inboundDelayPolls: LOCAL_RANKED_ROOT_SMOKE_INBOUND_DELAY_POLLS,
  };
}

export function installLocalRankedRootSmokeBridge(
  config: LocalRankedRootSmokeConfig,
  bridge: LocalRankedRootSmokeBridge,
  target: LocalRankedRootSmokeWindow = window,
): () => void {
  if (!config.enabled) {
    return () => undefined;
  }
  if (bridge.schemaVersion !== LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION) {
    throw new Error('The local ranked root smoke bridge schema is invalid.');
  }
  target.__gravityWellLocalRankedRootSmoke = bridge;
  return () => {
    if (target.__gravityWellLocalRankedRootSmoke === bridge) {
      delete target.__gravityWellLocalRankedRootSmoke;
    }
  };
}
