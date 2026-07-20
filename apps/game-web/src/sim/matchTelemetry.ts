import {
  CHARACTER_PACKAGE_VERSION_BY_ID,
  CHARACTER_REGISTRY_FINGERPRINT,
  CHARACTER_REGISTRY_SCHEMA_VERSION,
  type CharacterId,
} from './characters';
import {
  COMBAT_ORDINARY_BOOST_OUTCOMES,
  COMBAT_EVENT_TYPES,
  CombatEventTelemetryTracker,
  type CombatAction,
  type CombatDistanceBand,
  type CombatEventTelemetrySummary,
  type CombatEventType,
  type CombatLaunchClashCause,
  type CombatOrdinaryBoostOutcome,
  type CombatResourceTelemetry,
} from './combatEventTelemetry';
import type { FrameInput, GameState, PlayerId, PlayerState, PlayersById } from './types';
import {
  fingerprintCharacterBalanceConfig,
  resolveCharacterRulesFingerprint,
} from './characterBalance';
import type {
  SimulationActionStart,
  SimulationControlReturnReset,
  SimulationLaunchClash,
} from './sim';

export const PREVIOUS_MATCH_TELEMETRY_SCHEMA_VERSION = 'gw.match-telemetry.v9';
export const PREVIOUS_MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION = 'gw.match-telemetry-aggregate.v9';
export const MATCH_TELEMETRY_SCHEMA_VERSION = 'gw.match-telemetry.v10';
export const MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION = 'gw.match-telemetry-aggregate.v10';
export const MATCH_TELEMETRY_CONTACT_PADDING = 0.75;
export const MATCH_TELEMETRY_SUSTAINED_DECISION_WINDOW_SECONDS = 0.75;

export interface MatchTelemetryMovementIntentSummary {
  controllableFrames: number;
  approachFrames: number;
  retreatFrames: number;
  orbitFrames: number;
  idleFrames: number;
  contactFrames: number;
  contactApproachFrames: number;
  contactRetreatFrames: number;
  contactOrbitFrames: number;
  contactIdleFrames: number;
  contestedContactFrames: number;
  contestedContactApproachFrames: number;
  contestedContactRetreatFrames: number;
  contestedContactOrbitFrames: number;
  contestedContactIdleFrames: number;
  pressureFrames: number;
  pressureApproachFrames: number;
  pressureRetreatFrames: number;
  pointBlankFrames: number;
  pointBlankApproachFrames: number;
  pointBlankRetreatFrames: number;
  contestedPressureFrames: number;
  contestedPressureApproachFrames: number;
  contestedPressureRetreatFrames: number;
  contestedPointBlankFrames: number;
  contestedPointBlankApproachFrames: number;
  contestedPointBlankRetreatFrames: number;
}

export function arePlayersInTelemetryContact(state: GameState): boolean {
  const distance = Math.hypot(
    state.players.P2.pos.x - state.players.P1.pos.x,
    state.players.P2.pos.y - state.players.P1.pos.y,
  );
  return distance <= state.players.P1.radius
    + state.players.P2.radius
    + MATCH_TELEMETRY_CONTACT_PADDING;
}

interface EpisodeDurationSummary {
  episodeCount: number;
  episodeDurationsSeconds: number[];
  averageEpisodeSeconds: number;
  maximumEpisodeSeconds: number;
  p90EpisodeSeconds: number;
}

interface EpisodeTracker {
  completedDurationsSeconds: number[];
  activeSeconds: number | null;
}

function createEpisodeTracker(): EpisodeTracker {
  return {
    completedDurationsSeconds: [],
    activeSeconds: null,
  };
}

function resetEpisodeTracker(tracker: EpisodeTracker): void {
  tracker.completedDurationsSeconds.length = 0;
  tracker.activeSeconds = null;
}

function recordEpisodeFrame(
  tracker: EpisodeTracker,
  active: boolean,
  frameSeconds: number,
): void {
  if (active) {
    tracker.activeSeconds = (tracker.activeSeconds ?? 0) + frameSeconds;
    return;
  }
  if (tracker.activeSeconds !== null) {
    tracker.completedDurationsSeconds.push(tracker.activeSeconds);
    tracker.activeSeconds = null;
  }
}

function episodeDurationsSeconds(tracker: EpisodeTracker): number[] {
  return tracker.activeSeconds === null
    ? [...tracker.completedDurationsSeconds]
    : [...tracker.completedDurationsSeconds, tracker.activeSeconds];
}

function summariseEpisodes(durationsSeconds: readonly number[]): EpisodeDurationSummary {
  const sortedDurations = [...durationsSeconds].sort((left, right) => left - right);
  const roundSeconds = (seconds: number): number => Number(seconds.toFixed(3));
  const percentileIndex = Math.max(0, Math.ceil(sortedDurations.length * 0.9) - 1);
  const totalSeconds = sortedDurations.reduce((total, duration) => total + duration, 0);
  return {
    episodeCount: sortedDurations.length,
    episodeDurationsSeconds: sortedDurations.map(roundSeconds),
    averageEpisodeSeconds: sortedDurations.length > 0
      ? roundSeconds(totalSeconds / sortedDurations.length)
      : 0,
    maximumEpisodeSeconds: sortedDurations.length > 0
      ? roundSeconds(sortedDurations[sortedDurations.length - 1] ?? 0)
      : 0,
    p90EpisodeSeconds: sortedDurations.length > 0
      ? roundSeconds(sortedDurations[percentileIndex] ?? 0)
      : 0,
  };
}

function summariseContactEpisodes(durationsSeconds: readonly number[]) {
  const summary = summariseEpisodes(durationsSeconds);
  return {
    contactEpisodeCount: summary.episodeCount,
    contactEpisodeDurationsSeconds: summary.episodeDurationsSeconds,
    averageContactEpisodeSeconds: summary.averageEpisodeSeconds,
    maximumContactEpisodeSeconds: summary.maximumEpisodeSeconds,
    p90ContactEpisodeSeconds: summary.p90EpisodeSeconds,
  };
}

export interface MatchTelemetryCharacterIdentity {
  characterId: CharacterId;
  packageVersion: string;
}

export interface MatchTelemetryPlayerSummary {
  launchPresses: number;
  specialPresses: number;
  dunkPresses: number;
  parryPresses: number;
  breakPresses: number;
  acceptedActionStarts: number;
  launchStarts: number;
  specialStarts: number;
  dunkStarts: number;
  parryStarts: number;
  boostStarts: number;
  superBoostStarts: number;
  breakEscapes: number;
  boostFrames: number;
  superBoostFrames: number;
  launchHits: number;
  clashCount: number;
  dunkHits: number;
  specialResolves: number;
  projectilesSpawned: number;
  projectileImpacts: number;
  projectilesExpiredOrCulled: number;
  averageBreakReactionSeconds: number;
  launchConversionRate: number;
  dunkConversionRate: number;
  projectileImpactRate: number;
  movementIntent: MatchTelemetryMovementIntentSummary;
}

export interface MatchTelemetrySpacingSummary {
  averageDistance: number;
  closestDistance: number;
  farthestDistance: number;
  contactFrames: number;
  contactSeconds: number;
  contactEpisodeCount: number;
  contactEpisodeDurationsSeconds: number[];
  averageContactEpisodeSeconds: number;
  maximumContactEpisodeSeconds: number;
  p90ContactEpisodeSeconds: number;
  pointBlankFrames: number;
  pointBlankSeconds: number;
  pressureBandFrames: number;
  pressureBandSeconds: number;
}

export interface MatchTelemetrySharedAgencySummary {
  controlFrames: number;
  controlSeconds: number;
  actionReadyFrames: number;
  actionReadySeconds: number;
  contactFrames: number;
  contactSeconds: number;
  contactEpisodeCount: number;
  contactEpisodeDurationsSeconds: number[];
  averageContactEpisodeSeconds: number;
  maximumContactEpisodeSeconds: number;
  p90ContactEpisodeSeconds: number;
  pressureFrames: number;
  pressureSeconds: number;
  neutralFrames: number;
  neutralSeconds: number;
  neutralEpisodeCount: number;
  neutralEpisodeDurationsSeconds: number[];
  averageNeutralEpisodeSeconds: number;
  maximumNeutralEpisodeSeconds: number;
  p90NeutralEpisodeSeconds: number;
  sustainedNeutralWindowCount: number;
  sustainedNeutralWindowSeconds: number;
}

export interface MatchTelemetrySummary {
  schemaVersion: typeof MATCH_TELEMETRY_SCHEMA_VERSION;
  characterRegistrySchemaVersion: typeof CHARACTER_REGISTRY_SCHEMA_VERSION;
  characterRegistryFingerprint: string;
  characters: PlayersById<MatchTelemetryCharacterIdentity>;
  framesSimulated: number;
  elapsedSeconds: number;
  players: PlayersById<MatchTelemetryPlayerSummary>;
  spacing: MatchTelemetrySpacingSummary;
  sharedAgency: MatchTelemetrySharedAgencySummary;
  combat: CombatEventTelemetrySummary;
}

export interface MatchTelemetryAggregatePlayerSummary extends MatchTelemetryPlayerSummary, CombatResourceTelemetry {}

export interface MatchTelemetryAggregateSpacingSummary extends MatchTelemetrySpacingSummary {
  contactRatio: number;
  pointBlankRatio: number;
  pressureBandRatio: number;
  distanceBandFrames: Record<CombatDistanceBand, number>;
}

export interface MatchTelemetryAggregateSharedAgencySummary extends MatchTelemetrySharedAgencySummary {
  controlRatio: number;
  actionReadyRatio: number;
  actionReadyShareOfControlFrames: number;
  contactRatio: number;
  pressureRatio: number;
  neutralRatio: number;
}

export interface MatchTelemetryAggregateOrdinaryBoostCounterplaySummary {
  opportunities: number;
  completedOpportunities: number;
  firstResponses: number;
  targetSuperBoostResponses: number;
  firstResponseActions: Record<CombatAction | 'none', number>;
  outcomes: Record<CombatOrdinaryBoostOutcome, number>;
  responseCoverageRatio: number;
  superBoostResponseRatio: number;
  averageFirstResponseSeconds: number | null;
  averageAvailableReactionSeconds: number | null;
  averageStartDistance: number | null;
}

export interface MatchTelemetryAggregateSummary {
  schemaVersion: typeof MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION;
  matchTelemetrySchemaVersion: typeof MATCH_TELEMETRY_SCHEMA_VERSION;
  characterRegistryFingerprint: string;
  characters: PlayersById<MatchTelemetryCharacterIdentity>;
  rounds: number;
  framesSimulated: number;
  elapsedSeconds: number;
  players: PlayersById<MatchTelemetryAggregatePlayerSummary>;
  spacing: MatchTelemetryAggregateSpacingSummary;
  sharedAgency: MatchTelemetryAggregateSharedAgencySummary;
  ordinaryBoostCounterplay: PlayersById<MatchTelemetryAggregateOrdinaryBoostCounterplaySummary>;
  eventCounts: Record<CombatEventType, number>;
  launchClashCauses: Record<CombatLaunchClashCause, number>;
}

interface TrackedInputState {
  launch: boolean;
  special: boolean;
  dunk: boolean;
  parry: boolean;
  breakLaunch: boolean;
}

interface TrackedPlayerState {
  helpless: number;
  launchBreaks: number;
  lastLaunchedBy: PlayerId | null;
  launchFlash: number;
  launchActive: number;
  dunkDidConnect: boolean;
  specialDidResolve: boolean;
}

interface TrackedState {
  p1: TrackedPlayerState;
  p2: TrackedPlayerState;
  projectileCount: number;
}

function createPlayerSummary(): MatchTelemetryPlayerSummary {
  return {
    launchPresses: 0,
    specialPresses: 0,
    dunkPresses: 0,
    parryPresses: 0,
    breakPresses: 0,
    acceptedActionStarts: 0,
    launchStarts: 0,
    specialStarts: 0,
    dunkStarts: 0,
    parryStarts: 0,
    boostStarts: 0,
    superBoostStarts: 0,
    breakEscapes: 0,
    boostFrames: 0,
    superBoostFrames: 0,
    launchHits: 0,
    clashCount: 0,
    dunkHits: 0,
    specialResolves: 0,
    projectilesSpawned: 0,
    projectileImpacts: 0,
    projectilesExpiredOrCulled: 0,
    averageBreakReactionSeconds: 0,
    launchConversionRate: 0,
    dunkConversionRate: 0,
    projectileImpactRate: 0,
    movementIntent: {
      controllableFrames: 0,
      approachFrames: 0,
      retreatFrames: 0,
      orbitFrames: 0,
      idleFrames: 0,
      contactFrames: 0,
      contactApproachFrames: 0,
      contactRetreatFrames: 0,
      contactOrbitFrames: 0,
      contactIdleFrames: 0,
      contestedContactFrames: 0,
      contestedContactApproachFrames: 0,
      contestedContactRetreatFrames: 0,
      contestedContactOrbitFrames: 0,
      contestedContactIdleFrames: 0,
      pressureFrames: 0,
      pressureApproachFrames: 0,
      pressureRetreatFrames: 0,
      pointBlankFrames: 0,
      pointBlankApproachFrames: 0,
      pointBlankRetreatFrames: 0,
      contestedPressureFrames: 0,
      contestedPressureApproachFrames: 0,
      contestedPressureRetreatFrames: 0,
      contestedPointBlankFrames: 0,
      contestedPointBlankApproachFrames: 0,
      contestedPointBlankRetreatFrames: 0,
    },
  };
}

function describeCharacters(state: GameState): PlayersById<MatchTelemetryCharacterIdentity> {
  const describe = (characterId: CharacterId): MatchTelemetryCharacterIdentity => {
    const override = state.characterBalanceOverrides[characterId];
    const baseVersion = CHARACTER_PACKAGE_VERSION_BY_ID[characterId] ?? 'unknown';
    return {
      characterId,
      packageVersion: override
        ? `${baseVersion}+local.${fingerprintCharacterBalanceConfig(override).slice('fnv1a32:'.length)}`
        : baseVersion,
    };
  };
  return {
    P1: describe(state.players.P1.characterId),
    P2: describe(state.players.P2.characterId),
  };
}

function toTrackedPlayerState(player: PlayerState): TrackedPlayerState {
  return {
    helpless: player.helpless,
    launchBreaks: player.launchBreaks,
    lastLaunchedBy: player.lastLaunchedBy,
    launchFlash: player.launchFlash,
    launchActive: player.launchActive,
    dunkDidConnect: player.dunkDidConnect,
    specialDidResolve: player.specialDidResolve,
  };
}

function toTrackedState(state: GameState): TrackedState {
  return {
    p1: toTrackedPlayerState(state.players.P1),
    p2: toTrackedPlayerState(state.players.P2),
    projectileCount: state.projectiles.length,
  };
}

export class MatchTelemetryTracker {
  private static readonly POINT_BLANK_DISTANCE = 12;
  private static readonly PRESSURE_BAND_DISTANCE = 24;

  private framesSimulated = 0;
  private elapsedSeconds = 0;
  private readonly players: PlayersById<MatchTelemetryPlayerSummary> = {
    P1: createPlayerSummary(),
    P2: createPlayerSummary(),
  };
  private readonly breakReactionSeconds: PlayersById<number> = {
    P1: 0,
    P2: 0,
  };
  private readonly helplessDurationSeconds: PlayersById<number> = {
    P1: 0,
    P2: 0,
  };
  private previousInput: PlayersById<TrackedInputState | null> = {
    P1: null,
    P2: null,
  };
  private previousState: TrackedState | null = null;
  private characters: PlayersById<MatchTelemetryCharacterIdentity> = {
    P1: { characterId: 'unknown', packageVersion: 'unknown' },
    P2: { characterId: 'unknown', packageVersion: 'unknown' },
  };
  private characterRegistryFingerprint = CHARACTER_REGISTRY_FINGERPRINT;
  private readonly combatTelemetry = new CombatEventTelemetryTracker();
  private accumulatedDistance = 0;
  private closestDistance = Number.POSITIVE_INFINITY;
  private farthestDistance = 0;
  private contactFrames = 0;
  private contactSeconds = 0;
  private readonly completedContactEpisodeDurationsSeconds: number[] = [];
  private activeContactEpisodeSeconds: number | null = null;
  private pointBlankFrames = 0;
  private pressureBandFrames = 0;
  private sharedActionReadyFrames = 0;
  private sharedActionReadySeconds = 0;
  private sharedControlFrames = 0;
  private sharedControlSeconds = 0;
  private sharedContactFrames = 0;
  private sharedContactSeconds = 0;
  private sharedPressureFrames = 0;
  private sharedPressureSeconds = 0;
  private sharedNeutralFrames = 0;
  private sharedNeutralSeconds = 0;
  private readonly sharedContactEpisodes = createEpisodeTracker();
  private readonly sharedNeutralEpisodes = createEpisodeTracker();

  public startRound(state: GameState): void {
    this.framesSimulated = 0;
    this.elapsedSeconds = 0;
    this.players.P1 = createPlayerSummary();
    this.players.P2 = createPlayerSummary();
    this.breakReactionSeconds.P1 = 0;
    this.breakReactionSeconds.P2 = 0;
    this.helplessDurationSeconds.P1 = 0;
    this.helplessDurationSeconds.P2 = 0;
    this.previousInput = {
      P1: null,
      P2: null,
    };
    this.accumulatedDistance = 0;
    this.closestDistance = Number.POSITIVE_INFINITY;
    this.farthestDistance = 0;
    this.contactFrames = 0;
    this.contactSeconds = 0;
    this.completedContactEpisodeDurationsSeconds.length = 0;
    this.activeContactEpisodeSeconds = null;
    this.pointBlankFrames = 0;
    this.pressureBandFrames = 0;
    this.sharedActionReadyFrames = 0;
    this.sharedActionReadySeconds = 0;
    this.sharedControlFrames = 0;
    this.sharedControlSeconds = 0;
    this.sharedContactFrames = 0;
    this.sharedContactSeconds = 0;
    this.sharedPressureFrames = 0;
    this.sharedPressureSeconds = 0;
    this.sharedNeutralFrames = 0;
    this.sharedNeutralSeconds = 0;
    resetEpisodeTracker(this.sharedContactEpisodes);
    resetEpisodeTracker(this.sharedNeutralEpisodes);
    this.previousState = toTrackedState(state);
    this.characters = describeCharacters(state);
    this.characterRegistryFingerprint = resolveCharacterRulesFingerprint(
      CHARACTER_REGISTRY_FINGERPRINT,
      state.characterBalanceOverrides,
    );
    this.combatTelemetry.startRound(state);
  }

  public recordFrame(
    frameInput: FrameInput,
    state: GameState,
    dt: number,
    acceptedActionStarts?: readonly SimulationActionStart[],
    launchClashes?: readonly SimulationLaunchClash[],
    controlReturnResets?: readonly SimulationControlReturnReset[],
  ): void {
    const frameSeconds = Math.max(0, dt);
    this.framesSimulated += 1;
    this.elapsedSeconds += frameSeconds;

    const distance = Math.hypot(
      state.players.P2.pos.x - state.players.P1.pos.x,
      state.players.P2.pos.y - state.players.P1.pos.y,
    );
    this.accumulatedDistance += distance;
    this.closestDistance = Math.min(this.closestDistance, distance);
    this.farthestDistance = Math.max(this.farthestDistance, distance);
    const inContact = arePlayersInTelemetryContact(state);
    this.recordContactFrame(inContact, frameSeconds);
    if (distance <= MatchTelemetryTracker.POINT_BLANK_DISTANCE) {
      this.pointBlankFrames += 1;
    }
    if (distance <= MatchTelemetryTracker.PRESSURE_BAND_DISTANCE) {
      this.pressureBandFrames += 1;
    }
    this.recordSharedAgencyFrame(state, distance, inContact, frameSeconds);
    this.recordMovementIntent('P1', frameInput.p1, state, distance, inContact);
    this.recordMovementIntent('P2', frameInput.p2, state, distance, inContact);

    const currentState = toTrackedState(state);
    const previousState = this.previousState;
    this.recordPlayerInput('P1', frameInput.p1);
    this.recordPlayerInput('P2', frameInput.p2);
    if (previousState) {
      this.recordBreakEscape('P1', previousState.p1, currentState.p1, dt);
      this.recordBreakEscape('P2', previousState.p2, currentState.p2, dt);
      if (
        previousState.p2.helpless <= 0
        && currentState.p2.helpless > 0
        && currentState.p2.lastLaunchedBy === 'P1'
      ) {
        this.players.P1.launchHits += 1;
      }
      if (
        previousState.p1.helpless <= 0
        && currentState.p1.helpless > 0
        && currentState.p1.lastLaunchedBy === 'P2'
      ) {
        this.players.P2.launchHits += 1;
      }
      if (!previousState.p1.dunkDidConnect && currentState.p1.dunkDidConnect) {
        this.players.P1.dunkHits += 1;
      }
      if (!previousState.p2.dunkDidConnect && currentState.p2.dunkDidConnect) {
        this.players.P2.dunkHits += 1;
      }
      if (!previousState.p1.specialDidResolve && currentState.p1.specialDidResolve) {
        this.players.P1.specialResolves += 1;
      }
      if (!previousState.p2.specialDidResolve && currentState.p2.specialDidResolve) {
        this.players.P2.specialResolves += 1;
      }
      const clashTriggered = previousState.p1.launchFlash <= 0
        && previousState.p2.launchFlash <= 0
        && currentState.p1.launchFlash > 0
        && currentState.p2.launchFlash > 0
        && currentState.p1.helpless <= 0
        && currentState.p2.helpless <= 0
        && currentState.p1.launchActive <= 0
        && currentState.p2.launchActive <= 0;
      if (clashTriggered) {
        this.players.P1.clashCount += 1;
        this.players.P2.clashCount += 1;
      }
      const projectileDelta = currentState.projectileCount - previousState.projectileCount;
      if (projectileDelta > 0) {
        if (!previousState.p1.specialDidResolve && currentState.p1.specialDidResolve) {
          this.players.P1.projectilesSpawned += projectileDelta;
        } else if (!previousState.p2.specialDidResolve && currentState.p2.specialDidResolve) {
          this.players.P2.projectilesSpawned += projectileDelta;
        }
      }
    }

    this.updateHelplessDuration('P1', currentState.p1.helpless, dt);
    this.updateHelplessDuration('P2', currentState.p2.helpless, dt);

    this.combatTelemetry.recordFrame(
      frameInput,
      state,
      dt,
      acceptedActionStarts,
      launchClashes,
      controlReturnResets,
    );
    this.previousState = currentState;
  }

  public toSummary(): MatchTelemetrySummary {
    const combat = this.combatTelemetry.toSummary();
    const p1 = this.withDerivedRates('P1', combat);
    const p2 = this.withDerivedRates('P2', combat);
    const contactEpisodes = summariseContactEpisodes(this.contactEpisodeDurationsSeconds());
    const sharedContactEpisodes = summariseEpisodes(
      episodeDurationsSeconds(this.sharedContactEpisodes),
    );
    const sharedNeutralEpisodeDurations = episodeDurationsSeconds(this.sharedNeutralEpisodes);
    const sharedNeutralEpisodes = summariseEpisodes(sharedNeutralEpisodeDurations);
    const sustainedNeutralDurations = sharedNeutralEpisodeDurations.filter(
      (seconds) => seconds >= MATCH_TELEMETRY_SUSTAINED_DECISION_WINDOW_SECONDS,
    );
    return {
      schemaVersion: MATCH_TELEMETRY_SCHEMA_VERSION,
      characterRegistrySchemaVersion: CHARACTER_REGISTRY_SCHEMA_VERSION,
      characterRegistryFingerprint: this.characterRegistryFingerprint,
      characters: {
        P1: { ...this.characters.P1 },
        P2: { ...this.characters.P2 },
      },
      framesSimulated: this.framesSimulated,
      elapsedSeconds: Math.round(this.elapsedSeconds * 100) / 100,
      players: {
        P1: p1,
        P2: p2,
      },
      spacing: {
        averageDistance: this.framesSimulated > 0 ? Number((this.accumulatedDistance / this.framesSimulated).toFixed(2)) : 0,
        closestDistance: Number.isFinite(this.closestDistance) ? Number(this.closestDistance.toFixed(2)) : 0,
        farthestDistance: Number(this.farthestDistance.toFixed(2)),
        contactFrames: this.contactFrames,
        contactSeconds: Number(this.contactSeconds.toFixed(2)),
        ...contactEpisodes,
        pointBlankFrames: this.pointBlankFrames,
        pointBlankSeconds: Number((this.pointBlankFrames / 60).toFixed(2)),
        pressureBandFrames: this.pressureBandFrames,
        pressureBandSeconds: Number((this.pressureBandFrames / 60).toFixed(2)),
      },
      sharedAgency: {
        controlFrames: this.sharedControlFrames,
        controlSeconds: Number(this.sharedControlSeconds.toFixed(2)),
        actionReadyFrames: this.sharedActionReadyFrames,
        actionReadySeconds: Number(this.sharedActionReadySeconds.toFixed(2)),
        contactFrames: this.sharedContactFrames,
        contactSeconds: Number(this.sharedContactSeconds.toFixed(2)),
        contactEpisodeCount: sharedContactEpisodes.episodeCount,
        contactEpisodeDurationsSeconds: sharedContactEpisodes.episodeDurationsSeconds,
        averageContactEpisodeSeconds: sharedContactEpisodes.averageEpisodeSeconds,
        maximumContactEpisodeSeconds: sharedContactEpisodes.maximumEpisodeSeconds,
        p90ContactEpisodeSeconds: sharedContactEpisodes.p90EpisodeSeconds,
        pressureFrames: this.sharedPressureFrames,
        pressureSeconds: Number(this.sharedPressureSeconds.toFixed(2)),
        neutralFrames: this.sharedNeutralFrames,
        neutralSeconds: Number(this.sharedNeutralSeconds.toFixed(2)),
        neutralEpisodeCount: sharedNeutralEpisodes.episodeCount,
        neutralEpisodeDurationsSeconds: sharedNeutralEpisodes.episodeDurationsSeconds,
        averageNeutralEpisodeSeconds: sharedNeutralEpisodes.averageEpisodeSeconds,
        maximumNeutralEpisodeSeconds: sharedNeutralEpisodes.maximumEpisodeSeconds,
        p90NeutralEpisodeSeconds: sharedNeutralEpisodes.p90EpisodeSeconds,
        sustainedNeutralWindowCount: sustainedNeutralDurations.length,
        sustainedNeutralWindowSeconds: Number(
          sustainedNeutralDurations.reduce((total, seconds) => total + seconds, 0).toFixed(2),
        ),
      },
      combat,
    };
  }

  private recordSharedAgencyFrame(
    state: GameState,
    distance: number,
    inContact: boolean,
    frameSeconds: number,
  ): void {
    const bothControllable = !state.winner
      && this.isPlayerMovementControllable(state.players.P1)
      && this.isPlayerMovementControllable(state.players.P2);
    const bothActionReady = bothControllable
      && this.isPlayerActionReady(state.players.P1)
      && this.isPlayerActionReady(state.players.P2);
    const inPressure = distance <= MatchTelemetryTracker.PRESSURE_BAND_DISTANCE;
    const inSharedContact = bothActionReady && inContact;
    const inSharedNeutral = bothActionReady && !inPressure;

    recordEpisodeFrame(this.sharedContactEpisodes, inSharedContact, frameSeconds);
    recordEpisodeFrame(this.sharedNeutralEpisodes, inSharedNeutral, frameSeconds);
    if (bothControllable) {
      this.sharedControlFrames += 1;
      this.sharedControlSeconds += frameSeconds;
    }
    if (!bothActionReady) {
      return;
    }

    this.sharedActionReadyFrames += 1;
    this.sharedActionReadySeconds += frameSeconds;
    if (inContact) {
      this.sharedContactFrames += 1;
      this.sharedContactSeconds += frameSeconds;
    }
    if (inPressure) {
      this.sharedPressureFrames += 1;
      this.sharedPressureSeconds += frameSeconds;
      return;
    }
    this.sharedNeutralFrames += 1;
    this.sharedNeutralSeconds += frameSeconds;
  }

  private isPlayerMovementControllable(player: PlayerState): boolean {
    return player.helpless <= 0
      && player.stunned <= 0
      && player.recovering <= 0;
  }

  private isPlayerActionReady(player: PlayerState): boolean {
    return this.isPlayerMovementControllable(player)
      && player.endLag <= 0
      && player.parry <= 0
      && player.launchStartup <= 0
      && player.launchActive <= 0
      && player.dunkStartup <= 0
      && player.dunkActive <= 0
      && player.specialStartup <= 0
      && player.specialActive <= 0;
  }

  private recordPlayerInput(
    playerId: PlayerId,
    input: FrameInput['p1'],
  ): void {
    const summary = this.players[playerId];
    const previous = this.previousInput[playerId];
    const current: TrackedInputState = {
      launch: input.launch,
      special: input.special,
      dunk: input.dunk,
      parry: input.parry,
      breakLaunch: input.breakLaunch,
    };

    if (current.launch && (!previous || !previous.launch)) {
      summary.launchPresses += 1;
    }
    if (current.special && (!previous || !previous.special)) {
      summary.specialPresses += 1;
    }
    if (current.dunk && (!previous || !previous.dunk)) {
      summary.dunkPresses += 1;
    }
    if (current.parry && (!previous || !previous.parry)) {
      summary.parryPresses += 1;
    }
    if (current.breakLaunch && (!previous || !previous.breakLaunch)) {
      summary.breakPresses += 1;
    }
    if (input.boost) {
      summary.boostFrames += 1;
    }
    if (input.superBoost) {
      summary.superBoostFrames += 1;
    }

    this.previousInput[playerId] = current;
  }

  private recordMovementIntent(
    playerId: PlayerId,
    input: FrameInput['p1'],
    state: GameState,
    distance: number,
    inContact: boolean,
  ): void {
    const player = state.players[playerId];
    if (
      state.winner
      || player.helpless > 0
      || player.stunned > 0
      || player.recovering > 0
    ) {
      return;
    }

    const movement = this.players[playerId].movementIntent;
    const opponent = state.players[playerId === 'P1' ? 'P2' : 'P1'];
    const contested = opponent.helpless <= 0
      && opponent.stunned <= 0
      && opponent.recovering <= 0;
    movement.controllableFrames += 1;
    if (inContact) {
      movement.contactFrames += 1;
      if (contested) {
        movement.contestedContactFrames += 1;
      }
    }
    if (distance <= MatchTelemetryTracker.PRESSURE_BAND_DISTANCE) {
      movement.pressureFrames += 1;
      if (contested) {
        movement.contestedPressureFrames += 1;
      }
    }
    if (distance <= MatchTelemetryTracker.POINT_BLANK_DISTANCE) {
      movement.pointBlankFrames += 1;
      if (contested) {
        movement.contestedPointBlankFrames += 1;
      }
    }

    const magnitude = Math.hypot(input.moveX, input.moveY);
    if (magnitude < 0.2) {
      movement.idleFrames += 1;
      if (inContact) {
        movement.contactIdleFrames += 1;
        if (contested) {
          movement.contestedContactIdleFrames += 1;
        }
      }
      return;
    }

    const towardX = distance > 0.001 ? (opponent.pos.x - player.pos.x) / distance : 0;
    const towardY = distance > 0.001 ? (opponent.pos.y - player.pos.y) / distance : 0;
    const directionalDot = input.moveX / magnitude * towardX + input.moveY / magnitude * towardY;

    if (directionalDot > 0.35) {
      movement.approachFrames += 1;
      if (inContact) {
        movement.contactApproachFrames += 1;
        if (contested) {
          movement.contestedContactApproachFrames += 1;
        }
      }
      if (distance <= MatchTelemetryTracker.PRESSURE_BAND_DISTANCE) {
        movement.pressureApproachFrames += 1;
        if (contested) {
          movement.contestedPressureApproachFrames += 1;
        }
      }
      if (distance <= MatchTelemetryTracker.POINT_BLANK_DISTANCE) {
        movement.pointBlankApproachFrames += 1;
        if (contested) {
          movement.contestedPointBlankApproachFrames += 1;
        }
      }
      return;
    }
    if (directionalDot < -0.35) {
      movement.retreatFrames += 1;
      if (inContact) {
        movement.contactRetreatFrames += 1;
        if (contested) {
          movement.contestedContactRetreatFrames += 1;
        }
      }
      if (distance <= MatchTelemetryTracker.PRESSURE_BAND_DISTANCE) {
        movement.pressureRetreatFrames += 1;
        if (contested) {
          movement.contestedPressureRetreatFrames += 1;
        }
      }
      if (distance <= MatchTelemetryTracker.POINT_BLANK_DISTANCE) {
        movement.pointBlankRetreatFrames += 1;
        if (contested) {
          movement.contestedPointBlankRetreatFrames += 1;
        }
      }
      return;
    }
    movement.orbitFrames += 1;
    if (inContact) {
      movement.contactOrbitFrames += 1;
      if (contested) {
        movement.contestedContactOrbitFrames += 1;
      }
    }
  }

  private recordContactFrame(inContact: boolean, frameSeconds: number): void {
    if (inContact) {
      this.contactFrames += 1;
      this.contactSeconds += frameSeconds;
      this.activeContactEpisodeSeconds = (this.activeContactEpisodeSeconds ?? 0) + frameSeconds;
      return;
    }
    if (this.activeContactEpisodeSeconds !== null) {
      this.completedContactEpisodeDurationsSeconds.push(this.activeContactEpisodeSeconds);
      this.activeContactEpisodeSeconds = null;
    }
  }

  private contactEpisodeDurationsSeconds(): number[] {
    return this.activeContactEpisodeSeconds === null
      ? [...this.completedContactEpisodeDurationsSeconds]
      : [...this.completedContactEpisodeDurationsSeconds, this.activeContactEpisodeSeconds];
  }

  private recordBreakEscape(
    playerId: PlayerId,
    previous: TrackedPlayerState,
    current: TrackedPlayerState,
    dt: number,
  ): void {
    if (current.launchBreaks >= previous.launchBreaks) {
      return;
    }
    this.players[playerId].breakEscapes += 1;
    this.breakReactionSeconds[playerId] += this.helplessDurationSeconds[playerId] + Math.max(0, dt);
  }

  private updateHelplessDuration(playerId: PlayerId, helpless: number, dt: number): void {
    if (helpless > 0) {
      this.helplessDurationSeconds[playerId] += Math.max(0, dt);
      return;
    }
    this.helplessDurationSeconds[playerId] = 0;
  }

  private withDerivedRates(
    playerId: PlayerId,
    combat: CombatEventTelemetrySummary,
  ): MatchTelemetryPlayerSummary {
    const countActorEvents = (type: CombatEventType): number => combat.events.filter(
      (event) => event.type === type && event.actorId === playerId,
    ).length;
    const countActionStarts = (action: NonNullable<CombatEventTelemetrySummary['events'][number]['action']>): number => (
      combat.events.filter(
        (event) => event.type === 'action_start' && event.actorId === playerId && event.action === action,
      ).length
    );
    const launchStarts = countActionStarts('launch');
    const specialStarts = countActionStarts('special');
    const dunkStarts = countActionStarts('dunk');
    const parryStarts = countActionStarts('parry');
    const boostStarts = countActionStarts('boost');
    const superBoostStarts = countActionStarts('super_boost');
    const breakEscapes = countActorEvents('launch_break');
    const projectileImpacts = combat.events.filter(
      (event) => event.type === 'projectile_end' && event.actorId === playerId && event.outcome === 'impact',
    ).length;
    const projectilesExpiredOrCulled = combat.events.filter(
      (event) => event.type === 'projectile_end'
        && event.actorId === playerId
        && event.outcome === 'expired_or_culled',
    ).length;
    const summary: MatchTelemetryPlayerSummary = {
      ...this.players[playerId],
      acceptedActionStarts: launchStarts + specialStarts + dunkStarts + parryStarts
        + boostStarts + superBoostStarts + breakEscapes,
      launchStarts,
      specialStarts,
      dunkStarts,
      parryStarts,
      boostStarts,
      superBoostStarts,
      breakEscapes,
      launchHits: countActorEvents('launch_hit'),
      clashCount: combat.eventCounts.launch_clash,
      dunkHits: countActorEvents('dunk_hit'),
      specialResolves: countActorEvents('special_resolve'),
      projectilesSpawned: countActorEvents('projectile_spawn'),
      projectileImpacts,
      projectilesExpiredOrCulled,
    };
    return {
      ...summary,
      averageBreakReactionSeconds: summary.breakEscapes > 0
        ? Number((this.breakReactionSeconds[playerId] / summary.breakEscapes).toFixed(2))
        : 0,
      launchConversionRate: summary.launchStarts > 0
        ? Number((summary.launchHits / summary.launchStarts).toFixed(2))
        : 0,
      dunkConversionRate: summary.dunkStarts > 0
        ? Number((summary.dunkHits / summary.dunkStarts).toFixed(2))
        : 0,
      projectileImpactRate: summary.projectilesSpawned > 0
        ? Number((summary.projectileImpacts / summary.projectilesSpawned).toFixed(2))
        : 0,
    };
  }
}

export function createMatchTelemetryTracker(state: GameState): MatchTelemetryTracker {
  const tracker = new MatchTelemetryTracker();
  tracker.startRound(state);
  return tracker;
}

function createAggregatePlayerSummary(): MatchTelemetryAggregatePlayerSummary {
  return {
    ...createPlayerSummary(),
    fuelLost: 0,
    fuelRestored: 0,
    averageFuelPercent: 0,
    zeroFuelFrames: 0,
    zeroFuelSeconds: 0,
    helplessFrames: 0,
    helplessSeconds: 0,
  };
}

function createAggregateOrdinaryBoostCounterplaySummary(): MatchTelemetryAggregateOrdinaryBoostCounterplaySummary {
  return {
    opportunities: 0,
    completedOpportunities: 0,
    firstResponses: 0,
    targetSuperBoostResponses: 0,
    firstResponseActions: {
      boost: 0,
      super_boost: 0,
      special: 0,
      launch: 0,
      dunk: 0,
      parry: 0,
      launch_break: 0,
      none: 0,
    },
    outcomes: Object.fromEntries(
      COMBAT_ORDINARY_BOOST_OUTCOMES.map((outcome) => [outcome, 0]),
    ) as Record<CombatOrdinaryBoostOutcome, number>,
    responseCoverageRatio: 0,
    superBoostResponseRatio: 0,
    averageFirstResponseSeconds: null,
    averageAvailableReactionSeconds: null,
    averageStartDistance: null,
  };
}

function roundAggregateMetric(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

export function aggregateMatchTelemetrySummaries(
  summaries: readonly MatchTelemetrySummary[],
): MatchTelemetryAggregateSummary {
  const first = summaries[0];
  if (!first) {
    throw new Error('Cannot aggregate an empty match telemetry collection.');
  }
  for (const summary of summaries) {
    if (summary.characterRegistryFingerprint !== first.characterRegistryFingerprint) {
      throw new Error('Cannot aggregate telemetry from different character registries.');
    }
    for (const playerId of ['P1', 'P2'] as const) {
      const actual = summary.characters[playerId];
      const expected = first.characters[playerId];
      if (actual.characterId !== expected.characterId || actual.packageVersion !== expected.packageVersion) {
        throw new Error('Cannot aggregate telemetry from different character loadouts.');
      }
    }
  }

  const players: PlayersById<MatchTelemetryAggregatePlayerSummary> = {
    P1: createAggregatePlayerSummary(),
    P2: createAggregatePlayerSummary(),
  };
  const ordinaryBoostCounterplay: PlayersById<MatchTelemetryAggregateOrdinaryBoostCounterplaySummary> = {
    P1: createAggregateOrdinaryBoostCounterplaySummary(),
    P2: createAggregateOrdinaryBoostCounterplaySummary(),
  };
  const ordinaryBoostFirstResponseSeconds: PlayersById<number> = { P1: 0, P2: 0 };
  const ordinaryBoostAvailableReactionSeconds: PlayersById<number> = { P1: 0, P2: 0 };
  const ordinaryBoostStartDistance: PlayersById<number> = { P1: 0, P2: 0 };
  const breakReactionTotals: PlayersById<number> = { P1: 0, P2: 0 };
  const averageFuelTotals: PlayersById<number> = { P1: 0, P2: 0 };
  const eventCounts = Object.fromEntries(
    COMBAT_EVENT_TYPES.map((eventType) => [eventType, 0]),
  ) as Record<CombatEventType, number>;
  const launchClashCauses: Record<CombatLaunchClashCause, number> = {
    simultaneous_active: 0,
    global_startup_grace: 0,
    post_control_counter_launch: 0,
    unattributed: 0,
  };
  const distanceBandFrames: Record<CombatDistanceBand, number> = {
    point_blank: 0,
    pressure: 0,
    mid: 0,
    long: 0,
  };
  let framesSimulated = 0;
  let elapsedSeconds = 0;
  let weightedDistance = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  let farthestDistance = 0;
  let contactFrames = 0;
  let contactSeconds = 0;
  const contactEpisodeDurationsSeconds: number[] = [];
  let pointBlankFrames = 0;
  let pressureBandFrames = 0;
  let sharedActionReadyFrames = 0;
  let sharedActionReadySeconds = 0;
  let sharedControlFrames = 0;
  let sharedControlSeconds = 0;
  let sharedContactFrames = 0;
  let sharedContactSeconds = 0;
  const sharedContactEpisodeDurationsSeconds: number[] = [];
  let sharedPressureFrames = 0;
  let sharedPressureSeconds = 0;
  let sharedNeutralFrames = 0;
  let sharedNeutralSeconds = 0;
  const sharedNeutralEpisodeDurationsSeconds: number[] = [];
  let sustainedNeutralWindowCount = 0;
  let sustainedNeutralWindowSeconds = 0;

  for (const summary of summaries) {
    framesSimulated += summary.framesSimulated;
    elapsedSeconds += summary.elapsedSeconds;
    weightedDistance += summary.spacing.averageDistance * summary.framesSimulated;
    closestDistance = Math.min(closestDistance, summary.spacing.closestDistance);
    farthestDistance = Math.max(farthestDistance, summary.spacing.farthestDistance);
    contactFrames += summary.spacing.contactFrames;
    contactSeconds += summary.spacing.contactSeconds;
    contactEpisodeDurationsSeconds.push(...summary.spacing.contactEpisodeDurationsSeconds);
    pointBlankFrames += summary.spacing.pointBlankFrames;
    pressureBandFrames += summary.spacing.pressureBandFrames;
    sharedActionReadyFrames += summary.sharedAgency.actionReadyFrames;
    sharedActionReadySeconds += summary.sharedAgency.actionReadySeconds;
    sharedControlFrames += summary.sharedAgency.controlFrames;
    sharedControlSeconds += summary.sharedAgency.controlSeconds;
    sharedContactFrames += summary.sharedAgency.contactFrames;
    sharedContactSeconds += summary.sharedAgency.contactSeconds;
    sharedContactEpisodeDurationsSeconds.push(
      ...summary.sharedAgency.contactEpisodeDurationsSeconds,
    );
    sharedPressureFrames += summary.sharedAgency.pressureFrames;
    sharedPressureSeconds += summary.sharedAgency.pressureSeconds;
    sharedNeutralFrames += summary.sharedAgency.neutralFrames;
    sharedNeutralSeconds += summary.sharedAgency.neutralSeconds;
    sharedNeutralEpisodeDurationsSeconds.push(
      ...summary.sharedAgency.neutralEpisodeDurationsSeconds,
    );
    sustainedNeutralWindowCount += summary.sharedAgency.sustainedNeutralWindowCount;
    sustainedNeutralWindowSeconds += summary.sharedAgency.sustainedNeutralWindowSeconds;
    for (const eventType of COMBAT_EVENT_TYPES) {
      eventCounts[eventType] += summary.combat.eventCounts[eventType];
    }
    for (const cause of Object.keys(launchClashCauses) as CombatLaunchClashCause[]) {
      launchClashCauses[cause] += summary.combat.launchClashCauses[cause];
    }
    for (const window of summary.combat.ordinaryBoostCounterplay ?? []) {
      const target = ordinaryBoostCounterplay[window.targetId];
      target.opportunities += 1;
      target.outcomes[window.outcome] += 1;
      ordinaryBoostAvailableReactionSeconds[window.targetId] += window.availableReactionSeconds;
      ordinaryBoostStartDistance[window.targetId] += window.startDistance;
      if (window.outcome !== 'sample_end') {
        target.completedOpportunities += 1;
      }
      if (window.targetFirstAcceptedAction) {
        target.firstResponses += 1;
        target.firstResponseActions[window.targetFirstAcceptedAction.action] += 1;
        ordinaryBoostFirstResponseSeconds[window.targetId]
          += window.targetFirstAcceptedAction.delaySeconds;
      } else {
        target.firstResponseActions.none += 1;
      }
      if (window.targetSuperBoostResponse) {
        target.targetSuperBoostResponses += 1;
      }
    }
    for (const band of Object.keys(distanceBandFrames) as CombatDistanceBand[]) {
      distanceBandFrames[band] += summary.combat.spacingBands.frames[band];
    }
    for (const playerId of ['P1', 'P2'] as const) {
      const target = players[playerId];
      const source = summary.players[playerId];
      target.launchPresses += source.launchPresses;
      target.specialPresses += source.specialPresses;
      target.dunkPresses += source.dunkPresses;
      target.parryPresses += source.parryPresses;
      target.breakPresses += source.breakPresses;
      target.acceptedActionStarts += source.acceptedActionStarts;
      target.launchStarts += source.launchStarts;
      target.specialStarts += source.specialStarts;
      target.dunkStarts += source.dunkStarts;
      target.parryStarts += source.parryStarts;
      target.boostStarts += source.boostStarts;
      target.superBoostStarts += source.superBoostStarts;
      target.breakEscapes += source.breakEscapes;
      target.boostFrames += source.boostFrames;
      target.superBoostFrames += source.superBoostFrames;
      target.launchHits += source.launchHits;
      target.clashCount += source.clashCount;
      target.dunkHits += source.dunkHits;
      target.specialResolves += source.specialResolves;
      target.projectilesSpawned += source.projectilesSpawned;
      target.projectileImpacts += source.projectileImpacts;
      target.projectilesExpiredOrCulled += source.projectilesExpiredOrCulled;
      for (const key of Object.keys(target.movementIntent) as Array<keyof MatchTelemetryMovementIntentSummary>) {
        target.movementIntent[key] += source.movementIntent[key];
      }
      breakReactionTotals[playerId] += source.averageBreakReactionSeconds * source.breakEscapes;

      const resources = summary.combat.resources[playerId];
      target.fuelLost += resources.fuelLost;
      target.fuelRestored += resources.fuelRestored;
      averageFuelTotals[playerId] += resources.averageFuelPercent * summary.framesSimulated;
      target.zeroFuelFrames += resources.zeroFuelFrames;
      target.zeroFuelSeconds += resources.zeroFuelSeconds;
      target.helplessFrames += resources.helplessFrames;
      target.helplessSeconds += resources.helplessSeconds;
    }
  }

  for (const playerId of ['P1', 'P2'] as const) {
    const player = players[playerId];
    player.averageBreakReactionSeconds = player.breakEscapes > 0
      ? roundAggregateMetric(breakReactionTotals[playerId] / player.breakEscapes, 3)
      : 0;
    player.launchConversionRate = player.launchStarts > 0
      ? roundAggregateMetric(player.launchHits / player.launchStarts, 3)
      : 0;
    player.dunkConversionRate = player.dunkStarts > 0
      ? roundAggregateMetric(player.dunkHits / player.dunkStarts, 3)
      : 0;
    player.projectileImpactRate = player.projectilesSpawned > 0
      ? roundAggregateMetric(player.projectileImpacts / player.projectilesSpawned, 3)
      : 0;
    player.fuelLost = roundAggregateMetric(player.fuelLost, 2);
    player.fuelRestored = roundAggregateMetric(player.fuelRestored, 2);
    player.averageFuelPercent = framesSimulated > 0
      ? roundAggregateMetric(averageFuelTotals[playerId] / framesSimulated, 3)
      : 0;
    player.zeroFuelSeconds = roundAggregateMetric(player.zeroFuelSeconds, 2);
    player.helplessSeconds = roundAggregateMetric(player.helplessSeconds, 2);
    const boostCounterplay = ordinaryBoostCounterplay[playerId];
    boostCounterplay.responseCoverageRatio = roundAggregateMetric(
      boostCounterplay.firstResponses / Math.max(1, boostCounterplay.opportunities),
      3,
    );
    boostCounterplay.superBoostResponseRatio = roundAggregateMetric(
      boostCounterplay.targetSuperBoostResponses / Math.max(1, boostCounterplay.opportunities),
      3,
    );
    boostCounterplay.averageFirstResponseSeconds = boostCounterplay.firstResponses > 0
      ? roundAggregateMetric(
        ordinaryBoostFirstResponseSeconds[playerId] / boostCounterplay.firstResponses,
        3,
      )
      : null;
    boostCounterplay.averageAvailableReactionSeconds = boostCounterplay.opportunities > 0
      ? roundAggregateMetric(
        ordinaryBoostAvailableReactionSeconds[playerId] / boostCounterplay.opportunities,
        3,
      )
      : null;
    boostCounterplay.averageStartDistance = boostCounterplay.opportunities > 0
      ? roundAggregateMetric(
        ordinaryBoostStartDistance[playerId] / boostCounterplay.opportunities,
        2,
      )
      : null;
  }

  const sharedContactEpisodes = summariseEpisodes(sharedContactEpisodeDurationsSeconds);
  const sharedNeutralEpisodes = summariseEpisodes(sharedNeutralEpisodeDurationsSeconds);

  return {
    schemaVersion: MATCH_TELEMETRY_AGGREGATE_SCHEMA_VERSION,
    matchTelemetrySchemaVersion: MATCH_TELEMETRY_SCHEMA_VERSION,
    characterRegistryFingerprint: first.characterRegistryFingerprint,
    characters: {
      P1: { ...first.characters.P1 },
      P2: { ...first.characters.P2 },
    },
    rounds: summaries.length,
    framesSimulated,
    elapsedSeconds: roundAggregateMetric(elapsedSeconds, 2),
    players,
    ordinaryBoostCounterplay,
    spacing: {
      averageDistance: framesSimulated > 0 ? roundAggregateMetric(weightedDistance / framesSimulated, 2) : 0,
      closestDistance: Number.isFinite(closestDistance) ? roundAggregateMetric(closestDistance, 2) : 0,
      farthestDistance: roundAggregateMetric(farthestDistance, 2),
      contactFrames,
      contactSeconds: roundAggregateMetric(contactSeconds, 2),
      ...summariseContactEpisodes(contactEpisodeDurationsSeconds),
      pointBlankFrames,
      pointBlankSeconds: roundAggregateMetric(pointBlankFrames / 60, 2),
      pressureBandFrames,
      pressureBandSeconds: roundAggregateMetric(pressureBandFrames / 60, 2),
      contactRatio: framesSimulated > 0 ? roundAggregateMetric(contactFrames / framesSimulated, 3) : 0,
      pointBlankRatio: framesSimulated > 0 ? roundAggregateMetric(pointBlankFrames / framesSimulated, 3) : 0,
      pressureBandRatio: framesSimulated > 0 ? roundAggregateMetric(pressureBandFrames / framesSimulated, 3) : 0,
      distanceBandFrames,
    },
    sharedAgency: {
      controlFrames: sharedControlFrames,
      controlSeconds: roundAggregateMetric(sharedControlSeconds, 2),
      actionReadyFrames: sharedActionReadyFrames,
      actionReadySeconds: roundAggregateMetric(sharedActionReadySeconds, 2),
      contactFrames: sharedContactFrames,
      contactSeconds: roundAggregateMetric(sharedContactSeconds, 2),
      contactEpisodeCount: sharedContactEpisodes.episodeCount,
      contactEpisodeDurationsSeconds: sharedContactEpisodes.episodeDurationsSeconds,
      averageContactEpisodeSeconds: sharedContactEpisodes.averageEpisodeSeconds,
      maximumContactEpisodeSeconds: sharedContactEpisodes.maximumEpisodeSeconds,
      p90ContactEpisodeSeconds: sharedContactEpisodes.p90EpisodeSeconds,
      pressureFrames: sharedPressureFrames,
      pressureSeconds: roundAggregateMetric(sharedPressureSeconds, 2),
      neutralFrames: sharedNeutralFrames,
      neutralSeconds: roundAggregateMetric(sharedNeutralSeconds, 2),
      neutralEpisodeCount: sharedNeutralEpisodes.episodeCount,
      neutralEpisodeDurationsSeconds: sharedNeutralEpisodes.episodeDurationsSeconds,
      averageNeutralEpisodeSeconds: sharedNeutralEpisodes.averageEpisodeSeconds,
      maximumNeutralEpisodeSeconds: sharedNeutralEpisodes.maximumEpisodeSeconds,
      p90NeutralEpisodeSeconds: sharedNeutralEpisodes.p90EpisodeSeconds,
      sustainedNeutralWindowCount,
      sustainedNeutralWindowSeconds: roundAggregateMetric(sustainedNeutralWindowSeconds, 2),
      controlRatio: framesSimulated > 0
        ? roundAggregateMetric(sharedControlFrames / framesSimulated, 3)
        : 0,
      actionReadyRatio: framesSimulated > 0
        ? roundAggregateMetric(sharedActionReadyFrames / framesSimulated, 3)
        : 0,
      actionReadyShareOfControlFrames: sharedControlFrames > 0
        ? roundAggregateMetric(sharedActionReadyFrames / sharedControlFrames, 3)
        : 0,
      contactRatio: sharedActionReadyFrames > 0
        ? roundAggregateMetric(sharedContactFrames / sharedActionReadyFrames, 3)
        : 0,
      pressureRatio: sharedActionReadyFrames > 0
        ? roundAggregateMetric(sharedPressureFrames / sharedActionReadyFrames, 3)
        : 0,
      neutralRatio: sharedActionReadyFrames > 0
        ? roundAggregateMetric(sharedNeutralFrames / sharedActionReadyFrames, 3)
        : 0,
    },
    eventCounts,
    launchClashCauses,
  };
}
