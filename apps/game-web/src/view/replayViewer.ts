import type { PlayerId } from '../sim/types';
import {
  BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS,
  BALANCE_LAB_CONTROL_RETURN_ACTIONS,
  buildBalanceLabFightStory,
  describeBalanceLabReentryContext,
} from '../sim/balanceLab';
import type { BalanceLabExchangeReview } from '../sim/balanceLab';
import { resolveBalanceTestRecipe } from '../sim/balanceTestRecipes';
import type {
  ReplayReviewData,
  ReplayReviewFrame,
  ReplayRoundFlowReview,
} from '../sim/replayReview';
import {
  buildReplayDecisionFrameReview,
  formatReplayInput,
  type ReplayDecisionPlayerReview,
} from './replayDecisionReview';

export interface ReplayViewerOptions {
  onTogglePause(): void;
  onStep(direction: -1 | 1): void;
  onAdjustSpeed(direction: -1 | 1): void;
  onJumpRound(roundIndex: number): void;
  onSeek(frameIndex: number): void;
  onExit(): void;
}

export interface ReplayViewerController {
  show(data: ReplayReviewData, sourceLabel: string): void;
  hide(): void;
  isVisible(): boolean;
  updatePlayback(frameIndex: number, paused: boolean, speed: number): void;
  dispose(): void;
}

export class ReplayViewer implements ReplayViewerController {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly subtitle: HTMLDivElement;
  private readonly playPauseButton: HTMLButtonElement;
  private readonly speedLabel: HTMLSpanElement;
  private readonly frameLabel: HTMLSpanElement;
  private readonly roundSelect: HTMLSelectElement;
  private readonly seekInput: HTMLInputElement;
  private readonly timelineP1: HTMLDivElement;
  private readonly timelineP2: HTMLDivElement;
  private readonly decisionContent: HTMLDivElement;
  private readonly frameDataContent: HTMLDivElement;
  private readonly eventContent: HTMLDivElement;
  private readonly flowContent: HTMLDivElement;
  private readonly keydownHandler: (event: KeyboardEvent) => void;
  private visible = false;
  private review: ReplayReviewData | null = null;
  private currentFrameIndex = 0;
  private currentPaused = true;
  private currentSpeed = 1;
  private playbackRendered = false;

  constructor(private readonly options: ReplayViewerOptions) {
    this.root = document.createElement('div');
    this.root.className = 'replay-viewer';
    this.root.hidden = true;

    const header = document.createElement('div');
    header.className = 'replay-viewer-header';
    this.title = document.createElement('div');
    this.title.className = 'replay-viewer-title';
    this.subtitle = document.createElement('div');
    this.subtitle.className = 'replay-viewer-subtitle';
    header.append(this.title, this.subtitle);

    const controls = document.createElement('div');
    controls.className = 'replay-viewer-controls';
    this.playPauseButton = this.createControlButton('Pause / Resume [Space]', () => {
      this.options.onTogglePause();
    });
    const stepBack = this.createControlButton('Step -1 [,]', () => this.options.onStep(-1));
    const stepForward = this.createControlButton('Step +1 [.]', () => this.options.onStep(1));
    const speedDown = this.createControlButton('Speed [-]', () => this.options.onAdjustSpeed(-1));
    const speedUp = this.createControlButton('Speed [+]', () => this.options.onAdjustSpeed(1));
    const exit = this.createControlButton('Exit [Esc]', () => this.options.onExit());
    this.speedLabel = document.createElement('span');
    this.speedLabel.className = 'replay-viewer-meta';
    this.frameLabel = document.createElement('span');
    this.frameLabel.className = 'replay-viewer-meta';
    controls.append(
      this.playPauseButton,
      stepBack,
      stepForward,
      speedDown,
      speedUp,
      exit,
      this.speedLabel,
      this.frameLabel,
    );

    const jumpRow = document.createElement('div');
    jumpRow.className = 'replay-viewer-jump-row';
    const roundLabel = document.createElement('label');
    roundLabel.textContent = 'Round';
    this.roundSelect = document.createElement('select');
    this.roundSelect.addEventListener('change', () => {
      const index = Number(this.roundSelect.value);
      if (!Number.isFinite(index)) {
        return;
      }
      this.options.onJumpRound(index);
    });
    roundLabel.appendChild(this.roundSelect);

    const seekLabel = document.createElement('label');
    seekLabel.textContent = 'Frame';
    this.seekInput = document.createElement('input');
    this.seekInput.type = 'range';
    this.seekInput.min = '0';
    this.seekInput.max = '0';
    this.seekInput.step = '1';
    this.seekInput.value = '0';
    this.seekInput.addEventListener('input', () => {
      const value = Number(this.seekInput.value);
      if (!Number.isFinite(value)) {
        return;
      }
      this.options.onSeek(Math.floor(value));
    });
    seekLabel.appendChild(this.seekInput);
    jumpRow.append(roundLabel, seekLabel);

    const timelineWrap = document.createElement('div');
    timelineWrap.className = 'replay-viewer-timeline-wrap';
    this.timelineP1 = this.createTimelineRow('P1');
    this.timelineP2 = this.createTimelineRow('P2');
    timelineWrap.append(this.timelineP1, this.timelineP2);

    const decisionPanel = document.createElement('div');
    decisionPanel.className = 'replay-viewer-panel replay-decision-panel';
    decisionPanel.innerHTML = '<div class="panel-title">AI Decision → Input Request → Accepted Start → Outcome</div>';
    this.decisionContent = document.createElement('div');
    this.decisionContent.className = 'panel-content replay-decision-content';
    decisionPanel.appendChild(this.decisionContent);

    const body = document.createElement('div');
    body.className = 'replay-viewer-body';
    const frameDataPanel = document.createElement('div');
    frameDataPanel.className = 'replay-viewer-panel';
    frameDataPanel.innerHTML = '<div class="panel-title">Frame Data Overlay</div>';
    this.frameDataContent = document.createElement('div');
    this.frameDataContent.className = 'panel-content';
    frameDataPanel.appendChild(this.frameDataContent);

    const eventPanel = document.createElement('div');
    eventPanel.className = 'replay-viewer-panel';
    eventPanel.innerHTML = '<div class="panel-title">Recent Events</div>';
    this.eventContent = document.createElement('div');
    this.eventContent.className = 'panel-content';
    eventPanel.appendChild(this.eventContent);

    const flowPanel = document.createElement('div');
    flowPanel.className = 'replay-viewer-panel replay-flow-panel';
    flowPanel.innerHTML = '<div class="panel-title">Gameplay Flow Review</div>';
    this.flowContent = document.createElement('div');
    this.flowContent.className = 'panel-content';
    this.flowContent.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const seekButton = target.closest<HTMLButtonElement>('[data-seek-frame]');
      if (!seekButton) {
        return;
      }
      const frame = Number(seekButton.dataset.seekFrame);
      if (Number.isInteger(frame)) {
        this.options.onSeek(frame);
      }
    });
    flowPanel.appendChild(this.flowContent);
    body.append(frameDataPanel, eventPanel, flowPanel);

    this.root.append(header, controls, jumpRow, timelineWrap, decisionPanel, body);
    document.body.appendChild(this.root);

    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.visible) {
        return;
      }
      const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (!key) {
        return;
      }
      if (key === 'escape') {
        event.preventDefault();
        this.options.onExit();
        return;
      }
      if (key === ' ') {
        event.preventDefault();
        this.options.onTogglePause();
        return;
      }
      if (key === ',' || key === 'arrowleft') {
        event.preventDefault();
        this.options.onStep(-1);
        return;
      }
      if (key === '.' || key === 'arrowright') {
        event.preventDefault();
        this.options.onStep(1);
        return;
      }
      if (key === '[' || key === '-') {
        event.preventDefault();
        this.options.onAdjustSpeed(-1);
        return;
      }
      if (key === ']' || key === '=') {
        event.preventDefault();
        this.options.onAdjustSpeed(1);
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const index = Number(key) - 1;
        if (this.review && index < this.review.rounds.length) {
          event.preventDefault();
          this.options.onJumpRound(index);
        }
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  show(data: ReplayReviewData, sourceLabel: string): void {
    this.review = data;
    this.currentFrameIndex = 0;
    this.currentPaused = true;
    this.currentSpeed = 1;
    this.playbackRendered = false;
    this.visible = true;
    this.root.hidden = false;
    this.title.textContent = 'Replay Review';
    this.subtitle.textContent = `${sourceLabel} | Space pause, ,/. step, [-]/[+] speed, 1-9 jump round`;
    this.roundSelect.innerHTML = '';
    for (const round of data.rounds) {
      const option = document.createElement('option');
      option.value = String(round.index);
      option.textContent = `${round.label} (${round.startFrame}-${round.endFrame})`;
      this.roundSelect.appendChild(option);
    }
    this.seekInput.max = String(Math.max(0, data.totalFrames - 1));
    this.seekInput.value = '0';
    this.updatePlayback(0, true, 1);
  }

  hide(): void {
    this.visible = false;
    this.root.hidden = true;
    this.review = null;
    this.playbackRendered = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  updatePlayback(frameIndex: number, paused: boolean, speed: number): void {
    if (!this.review) {
      return;
    }
    const clampedFrame = Math.max(0, Math.min(this.review.totalFrames - 1, frameIndex));
    if (
      this.playbackRendered
      && this.currentFrameIndex === clampedFrame
      && this.currentPaused === paused
      && this.currentSpeed === speed
    ) {
      return;
    }
    const frame = this.review.frames[clampedFrame];
    this.currentFrameIndex = clampedFrame;
    this.currentPaused = paused;
    this.currentSpeed = speed;
    this.playbackRendered = true;
    this.playPauseButton.textContent = paused ? 'Resume [Space]' : 'Pause [Space]';
    this.speedLabel.textContent = `Speed: ${speed.toFixed(2)}x`;
    this.frameLabel.textContent = `Frame: ${clampedFrame + 1} / ${this.review.totalFrames}`;
    this.seekInput.value = String(clampedFrame);

    const roundIndex = this.findRoundIndex(clampedFrame);
    if (roundIndex >= 0) {
      this.roundSelect.value = String(roundIndex);
    }

    this.timelineP1.innerHTML = renderTimelineCells(this.review.frames, clampedFrame, 'P1');
    this.timelineP2.innerHTML = renderTimelineCells(this.review.frames, clampedFrame, 'P2');
    this.decisionContent.innerHTML = renderDecisionReview(this.review, clampedFrame);
    this.frameDataContent.innerHTML = renderFrameData(frame);
    this.eventContent.innerHTML = renderRecentEvents(this.review.frames, clampedFrame);
    const flowReview = this.review.flowReviews.find((review) => (
      clampedFrame >= review.startFrame && clampedFrame <= review.endFrame
    )) ?? this.review.flowReviews[0];
    this.flowContent.innerHTML = renderReplayFlowReview(flowReview, this.review.fixedDt);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keydownHandler);
    this.root.remove();
  }

  private findRoundIndex(frameIndex: number): number {
    if (!this.review) {
      return -1;
    }
    for (const round of this.review.rounds) {
      if (frameIndex >= round.startFrame && frameIndex <= round.endFrame) {
        return round.index;
      }
    }
    return this.review.rounds[0]?.index ?? -1;
  }

  private createControlButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'replay-viewer-btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private createTimelineRow(label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'replay-viewer-timeline-row';
    const heading = document.createElement('div');
    heading.className = 'replay-viewer-timeline-label';
    heading.textContent = label;
    const cells = document.createElement('div');
    cells.className = 'replay-viewer-timeline-cells';
    row.append(heading, cells);
    return cells;
  }
}

function renderTimelineCells(frames: ReplayReviewFrame[], frameIndex: number, playerId: PlayerId): string {
  const start = Math.max(0, frameIndex - 12);
  const end = Math.min(frames.length - 1, frameIndex + 12);
  const cells: string[] = [];
  for (let frame = start; frame <= end; frame += 1) {
    const input = playerId === 'P1' ? frames[frame].input.p1 : frames[frame].input.p2;
    const label = formatInput(input);
    const activeClass = frame === frameIndex ? ' active' : '';
    cells.push(`<span class="replay-input-cell${activeClass}" title="F${frame + 1}">${label}</span>`);
  }
  return cells.join('');
}

function formatInput(input: ReplayReviewFrame['input']['p1']): string {
  return formatReplayInput(input)
    .replace(/Super Boost/g, 'SB')
    .replace(/Launch Break/g, 'BR')
    .replace(/Special/g, 'SP')
    .replace(/Launch/g, 'LN')
    .replace(/Dunk/g, 'DK')
    .replace(/Parry/g, 'PR')
    .replace(/Boost/g, 'B')
    .replace(/Right/g, 'R')
    .replace(/Left/g, 'L')
    .replace(/Up/g, 'U')
    .replace(/Down/g, 'D')
    .replace(/Neutral/g, '.')
    .replace(/ \+ /g, '+');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDecisionLabel(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : 'none';
}

function renderDecisionPlayer(player: ReplayDecisionPlayerReview): string {
  if (player.eventFrame === null) {
    return `
      <div class="replay-decision-player ${player.playerId.toLowerCase()}">
        <div class="replay-decision-header"><strong>${player.playerId}</strong><span>No event yet</span></div>
        <div class="replay-decision-empty">${escapeHtml(player.requestedInput)}</div>
      </div>
    `;
  }
  const selectedAction = formatDecisionLabel(player.selectedAction);
  const age = player.ageFrames === 0 ? 'selected frame' : `${player.ageFrames}f ago`;
  const candidates = player.candidates.slice(0, 5).map((candidate) => `
    <span class="${candidate.eligible ? 'eligible' : 'blocked'}">
      ${escapeHtml(formatDecisionLabel(candidate.action))}
      ${candidate.eligible ? candidate.weight.toFixed(2) : `blocked: ${escapeHtml(candidate.reason)}`}
    </span>
  `).join('');
  return `
    <div class="replay-decision-player ${player.playerId.toLowerCase()}">
      <div class="replay-decision-header">
        <strong>${player.playerId} | F${player.eventFrame + 1}</strong>
        <span>${age}</span>
      </div>
      <div class="replay-decision-chain">
        <div><small>Decision</small><strong>${escapeHtml(formatDecisionLabel(player.movementIntent))} → ${escapeHtml(selectedAction)}</strong></div>
        <div><small>Input request</small><strong>${escapeHtml(player.requestedInput)}</strong></div>
        <div><small>Accepted start</small><strong>${escapeHtml(player.acceptedActions.map(formatDecisionLabel).join(', ') || 'none')}</strong></div>
        <div><small>Outcome</small><strong>${escapeHtml(player.outcome)}</strong></div>
      </div>
      <div class="replay-decision-meta">
        ${escapeHtml(player.profileId ?? 'unknown')} / ${escapeHtml(formatDecisionLabel(player.controllerRoleId))}
        | ${escapeHtml(player.context ?? 'no context')}
        | ${escapeHtml(player.selectedReason ?? 'no tactical selection')}
      </div>
      <div class="replay-decision-candidates">${candidates}</div>
    </div>
  `;
}

function renderDecisionReview(review: ReplayReviewData, frameIndex: number): string {
  const decisionReview = buildReplayDecisionFrameReview(review, frameIndex);
  if (!decisionReview.hasTrace) {
    return `
      <div class="replay-decision-empty">
        No AI decision trace is available in this human or legacy replay. Inputs, accepted starts,
        frame data, and outcomes remain reviewable below.
      </div>
    `;
  }
  return `
    <div class="replay-decision-grid">
      ${renderDecisionPlayer(decisionReview.players.P1)}
      ${renderDecisionPlayer(decisionReview.players.P2)}
    </div>
  `;
}

function renderFrameData(frame: ReplayReviewFrame): string {
  const p1 = frame.frameData.P1;
  const p2 = frame.frameData.P2;
  return [
    renderPlayerFrameData(p1),
    renderPlayerFrameData(p2),
  ].join('');
}

function renderPlayerFrameData(player: ReplayReviewFrame['frameData']['P1']): string {
  return `
    <div class="replay-frame-row">
      <strong>${player.playerId}</strong>
      <span>Status: ${player.status}</span>
      <span>Launch: ${formatMovePhase(player.launch)}</span>
      <span>Dunk: ${formatMovePhase(player.dunk)}</span>
      <span>Special: ${formatMovePhase(player.special)}</span>
      <span>Parry: ${player.parryFramesRemaining}f</span>
    </div>
  `;
}

function formatMovePhase(phase: ReplayReviewFrame['frameData']['P1']['launch']): string {
  if (phase.phase === 'startup') {
    return `startup ${phase.startupFramesRemaining}f`;
  }
  if (phase.phase === 'active') {
    return `active ${phase.activeFramesRemaining}f`;
  }
  if (phase.phase === 'recovery') {
    return `recovery ${phase.recoveryFramesRemaining}f`;
  }
  return 'idle';
}

function renderRecentEvents(frames: ReplayReviewFrame[], frameIndex: number): string {
  const recent: string[] = [];
  const start = Math.max(0, frameIndex - 40);
  for (let frame = start; frame <= frameIndex; frame += 1) {
    for (const event of frames[frame].events) {
      recent.push(`[F${event.frame + 1}] ${event.description}`);
    }
  }
  if (recent.length === 0) {
    return '<div class="replay-event-row">No move resolutions in this window.</div>';
  }
  return recent.slice(Math.max(0, recent.length - 8))
    .map((row) => `<div class="replay-event-row">${row}</div>`)
    .join('');
}

export function resolveReplayReentrySeekFrame(
  review: Pick<ReplayRoundFlowReview, 'startFrame' | 'endFrame'>,
  exchange: BalanceLabExchangeReview,
  fixedDt: number,
): number | null {
  if (
    exchange.status !== 'brief_exit'
    || !Number.isFinite(exchange.endSeconds)
    || !Number.isFinite(exchange.neutralWindowSeconds)
    || !Number.isFinite(fixedDt)
    || fixedDt <= 0
  ) {
    return null;
  }
  const reentrySeconds = Math.max(0, exchange.endSeconds + exchange.neutralWindowSeconds);
  return Math.max(
    review.startFrame,
    Math.min(review.endFrame, review.startFrame + Math.floor(reentrySeconds / fixedDt)),
  );
}

export function renderReplayFlowReview(
  review: ReplayRoundFlowReview | undefined,
  fixedDt: number,
): string {
  if (!review) {
    return '<div class="replay-event-row">No gameplay-flow telemetry is available.</div>';
  }
  const flow = review.flow;
  const story = buildBalanceLabFightStory(flow);
  const suggestedRecipe = story.suggestedRecipeId
    ? resolveBalanceTestRecipe(story.suggestedRecipeId)
    : null;
  const focusStageAttribute = story.focusStageId
    ? ` data-focus-stage="${escapeHtml(story.focusStageId)}"`
    : '';
  const suggestedCheck = suggestedRecipe && story.suggestedReason
    ? `
      <div class="balance-fight-story-next replay-fight-story-next">
        <div>
          <strong>Suggested controlled check: ${escapeHtml(suggestedRecipe.label)}</strong>
          <span>${escapeHtml(story.suggestedReason)} Observe for ${suggestedRecipe.suggestedDurationSeconds}s. This replay does not stage or change a rule.</span>
        </div>
      </div>
    `
    : '';
  const fightStory = `
    <section
      class="balance-fight-story replay-fight-story ${story.status}"
      data-story-status="${story.status}"${focusStageAttribute}
    >
      <div class="balance-fight-story-header">
        <span>Fight story</span>
        <strong>${escapeHtml(story.headline)}</strong>
      </div>
      <p class="balance-fight-story-overview">${escapeHtml(story.overview)}</p>
      <p class="balance-fight-story-finding">${escapeHtml(story.finding)}</p>
      ${suggestedCheck}
    </section>
  `;
  const resolved = flow.exchanges.filter((exchange) => exchange.resolved).length;
  const resets = flow.exchanges.filter((exchange) => exchange.createdReset).length;
  const actionCounts = (playerId: PlayerId): string => {
    const actions = flow.players[playerId].actionAcceptance;
    return [
      `LN ${actions.launch.starts}/${actions.launch.presses}`,
      `SP ${actions.special.starts}/${actions.special.presses}`,
      `DK ${actions.dunk.starts}/${actions.dunk.presses}`,
      `PR ${actions.parry.starts}/${actions.parry.presses}`,
      `BR ${actions.launch_break.starts}/${actions.launch_break.presses}`,
    ].join(' | ');
  };
  const playerLine = (playerId: PlayerId): string => {
    const player = flow.players[playerId];
    const repeat = player.longestRepeatedAction
      ? `${player.longestRepeatedAction} x${player.longestRepeatedActionStreak}`
      : 'none';
    const launchPressure = player.helplessSecondsPerLaunchReceived === null
      ? `${player.launchHitsReceived} received`
      : `${player.launchHitsReceived} received @ ${player.helplessSecondsPerLaunchReceived.toFixed(2)}s/hit`;
    const control = player.controlReturn;
    const controlReturn = control.controlReturns === 0
      ? 'none'
      : `${control.relaunchesWithinOneSecond}/${control.controlReturns} <=1s | ${control.averageControlWindowSeconds === null ? '--' : `${control.averageControlWindowSeconds.toFixed(2)}s avg`} | acted ${control.relaunchesWithAcceptedAction}/${control.relaunchesAfterControlReturn} | return reset ${control.sustainedResetsAfterControlReturn}/${control.controlReturnsInPressure} | action reset ${control.sustainedResetsAfterFirstAction}/${control.firstActionsInPressure}`;
    const postReturnMix = BALANCE_LAB_CONTROL_RETURN_ACTIONS
      .map((action) => ({ action, starts: control.firstAcceptedActions[action].starts }))
      .filter(({ starts }) => starts > 0)
      .sort((first, second) => second.starts - first.starts || first.action.localeCompare(second.action))
      .map(({ action, starts }) => `${action} ${starts}`)
      .join(' | ');
    const firstActionDelay = control.averageFirstActionDelaySeconds === null
      ? '--'
      : `${control.averageFirstActionDelaySeconds.toFixed(2)}s`;
    const clashDecision = flow.clashFollowUp.players[playerId];
    const postClashMix = BALANCE_LAB_CONTROL_RETURN_ACTIONS
      .map((action) => ({ action, starts: clashDecision.firstAcceptedActions[action].starts }))
      .filter(({ starts }) => starts > 0)
      .sort((first, second) => second.starts - first.starts || first.action.localeCompare(second.action))
      .map(({ action, starts }) => `${action} ${starts}`)
      .join(' | ');
    const clashActionDelay = clashDecision.averageFirstActionDelaySeconds === null
      ? '--'
      : `${clashDecision.averageFirstActionDelaySeconds.toFixed(2)}s`;
    return `
      <div class="replay-flow-player ${playerId.toLowerCase()}">
        <strong>${playerId}</strong>
        <span>Kit ${player.acceptedTacticalActions.length}/6</span>
        <span>Entropy ${player.tacticalActionEntropy.toFixed(2)}</span>
        <span>Dominant ${player.dominantTacticalAction ?? 'none'} ${Math.round(player.dominantTacticalActionShare * 100)}%</span>
        <span>Repeat ${repeat}</span>
        <span>Combat cadence ${player.acceptedActionsPerMinute.toFixed(1)}/min</span>
        <span>Launch pressure ${launchPressure}</span>
        <span>Contact intent A/O/D/I ${Math.round(player.movementIntent.contestedContactApproachRatio * 100)}%/${Math.round(player.movementIntent.contestedContactOrbitRatio * 100)}%/${Math.round(player.movementIntent.contestedContactRetreatRatio * 100)}%/${Math.round(player.movementIntent.contestedContactIdleRatio * 100)}% (${player.movementIntent.contestedContactFrames}f)</span>
        <span>Return to re-launch ${controlReturn}</span>
        <span>First after return ${postReturnMix || 'none'} | ${firstActionDelay} delay</span>
        <span>First after clash ${postClashMix || 'none'} | acted ${clashDecision.firstActions}/${flow.clashFollowUp.clashes} | rapid launch ${clashDecision.rapidLaunchRecommits} | ${clashActionDelay} delay</span>
        <small>Starts / presses: ${actionCounts(playerId)}</small>
      </div>
    `;
  };
  const spacingTimeline = flow.spacingTimeline.length > 0
    ? flow.spacingTimeline.map((segment) => `
        <span
          class="replay-flow-spacing-segment ${segment.band}"
          style="flex-grow:${Math.max(0.001, segment.durationSeconds)}"
          title="${segment.band}: ${segment.startSeconds.toFixed(1)}-${segment.endSeconds.toFixed(1)}s"
        ></span>
      `).join('')
    : '<span class="replay-flow-spacing-empty">No spacing samples</span>';
  const contactWindows = review.contactWindows.length > 0
    ? review.contactWindows.slice(-6).map((window, index) => `
        <button type="button" class="replay-flow-seek" data-seek-frame="${window.startFrame}">
          Contact ${Math.max(1, review.contactWindows.length - 5 + index)}: ${window.durationSeconds.toFixed(2)}s
        </button>
      `).join('')
    : '<span class="replay-flow-empty">No contact episodes.</span>';
  const exchangeRows = flow.exchanges.length > 0
    ? flow.exchanges.slice(-8).map((exchange) => {
      const seekFrame = Math.max(
        review.startFrame,
        Math.min(review.endFrame, review.startFrame + Math.floor(exchange.startSeconds / fixedDt)),
      );
      const outcome = exchange.outcomes.map((moment) => moment.label).join(', ') || 'no decisive outcome';
      const neutralDecision = exchange.firstNeutralActionActorId && exchange.firstNeutralAction
        ? `${exchange.firstNeutralActionActorId} ${exchange.firstNeutralAction.replace(/_/g, ' ')} +${exchange.firstNeutralActionDelaySeconds?.toFixed(2) ?? '0.00'}s`
        : exchange.status === 'brief_exit'
          ? `carried via ${exchange.carriedReentryCause
            ? BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[exchange.carriedReentryCause]
            : 'unattributed carry'}; no newly accepted action`
          : 'no accepted neutral action';
      const reentrySeekFrame = resolveReplayReentrySeekFrame(review, exchange, fixedDt);
      const reentryReview = reentrySeekFrame === null
        ? ''
        : `
          <button
            type="button"
            class="replay-flow-reentry"
            data-seek-frame="${reentrySeekFrame}"
            title="Seek to the frame where this brief exit collapses back into pressure"
          >
            Review re-entry @ ${(exchange.endSeconds + exchange.neutralWindowSeconds).toFixed(2)}s
          </button>
          <small class="replay-flow-reentry-context">${escapeHtml(describeBalanceLabReentryContext(exchange))}</small>
        `;
      return `
        <div class="replay-flow-exchange-card ${exchange.status}">
          <button type="button" class="replay-flow-exchange" data-seek-frame="${seekFrame}">
            <strong>#${exchange.exchangeNumber} ${exchange.openerActorId ?? 'Shared'} ${exchange.openerAction ?? 'pressure'}</strong>
            <span>${exchange.status} | ${exchange.pressureSeconds.toFixed(1)}s | exit ${exchange.exitBand ?? 'none'}</span>
            <small>${outcome} | first neutral: ${neutralDecision}</small>
          </button>
          ${reentryReview}
        </div>
      `;
    }).join('')
    : '<span class="replay-flow-empty">No pressure exchanges recorded.</span>';
  const diagnostics = flow.diagnostics.length > 0
    ? flow.diagnostics.slice(0, 4).map((diagnostic) => `
        <div class="replay-flow-diagnostic ${diagnostic.severity}">
          <strong>${diagnostic.title}</strong>
          <span>${diagnostic.detail}</span>
        </div>
      `).join('')
    : '<div class="replay-flow-diagnostic info"><strong>No diagnostic flags</strong></div>';
  const loopChain = flow.loopStages.map((stage, index) => `
      <div class="replay-loop-stage ${stage.status}">
        <div class="replay-loop-stage-header">
          <strong>${String(index + 1).padStart(2, '0')} ${stage.label}</strong>
          <span>${stage.status}</span>
        </div>
        <small>${stage.detail}</small>
      </div>
  `).join('');
  const clashRecurrenceOpportunities = Math.max(0, flow.clashFollowUp.clashes - 1);
  const clashRecurrence = clashRecurrenceOpportunities > 0
    ? `${flow.clashFollowUp.repeatClashesWithinOneSecond}/${clashRecurrenceOpportunities}`
    : '--';
  const carriedCauseMix = Object.entries(flow.neutralExitFollowUp.carriedBriefExitCauses)
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => (
      `${BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS[cause as keyof typeof BALANCE_LAB_CARRIED_REENTRY_CAUSE_LABELS]} ${count}`
    ))
    .join(', ') || 'none';

  return `
    <div class="replay-flow-round">${review.label} | ${flow.elapsedSeconds.toFixed(1)}s</div>
    <div class="replay-flow-reading-order">Start with the fight story, then seek to the exchange or re-entry that produced it. This is flow evidence, not a class win-rate verdict.</div>
    ${fightStory}
    <div class="replay-flow-section-label">Gameplay loop chain - flow evidence, not win-rate scoring</div>
    <div class="replay-loop-chain">${loopChain}</div>
    <div class="replay-flow-grid">
      <span>Contact <strong>${Math.round(flow.contactRatio * 100)}%</strong></span>
      <span>Point blank <strong>${Math.round(flow.pointBlankRatio * 100)}%</strong></span>
      <span>Launch clashes <strong>${flow.launchClashes} | ${flow.clashesPerMinute.toFixed(1)}/min</strong></span>
      <span>Clash recurrence <=1s <strong>${clashRecurrence}</strong></span>
      <span>Contact episodes <strong>${flow.contactEpisodes} | avg ${flow.averageContactEpisodeSeconds.toFixed(2)}s</strong></span>
      <span>Contact p90 / max <strong>${flow.p90ContactEpisodeSeconds.toFixed(2)}s / ${flow.maximumContactEpisodeSeconds.toFixed(2)}s</strong></span>
      <span>Neutral resets <strong>${flow.neutralResets}</strong></span>
      <span>Resets / min <strong>${flow.neutralResetsPerMinute.toFixed(1)}</strong></span>
      <span>Pressure avg / p90 <strong>${flow.averagePressureSequenceSeconds.toFixed(1)}s / ${flow.p90PressureSequenceSeconds.toFixed(1)}s</strong></span>
      <span>Longest pressure <strong>${flow.longestPressureSequenceSeconds.toFixed(1)}s</strong></span>
      <span>Exchanges <strong>${flow.exchanges.length}</strong></span>
      <span>Resolved / reset <strong>${resolved} / ${resets}</strong></span>
      <span>Carried brief re-entry <strong>${flow.neutralExitFollowUp.briefExitsWithoutAcceptedAction}/${flow.neutralExitFollowUp.briefExits}</strong></span>
      <span>Carried causes <strong>${carriedCauseMix}</strong></span>
      <span>Neutral action coverage <strong>${Math.round(flow.neutralExitFollowUp.firstActionCoverageRatio * 100)}%</strong></span>
    </div>
    <div class="replay-flow-section-label">Spacing over time</div>
    <div class="replay-flow-spacing">${spacingTimeline}</div>
    <div class="replay-flow-players">${playerLine('P1')}${playerLine('P2')}</div>
    <div class="replay-flow-section-label">Contact episodes - select to seek</div>
    <div class="replay-flow-seek-list">${contactWindows}</div>
    <div class="replay-flow-section-label">Exchange review - select to seek</div>
    <div class="replay-flow-exchanges">${exchangeRows}</div>
    <div class="replay-flow-diagnostics">${diagnostics}</div>
  `;
}

export function createReplayViewer(options: ReplayViewerOptions): ReplayViewerController {
  return new ReplayViewer(options);
}
