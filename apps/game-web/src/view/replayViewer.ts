import type { PlayerId } from '../sim/types';
import type { ReplayReviewData, ReplayReviewFrame } from '../sim/replayReview';

interface ReplayViewerOptions {
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
  private readonly frameDataContent: HTMLDivElement;
  private readonly eventContent: HTMLDivElement;
  private readonly keydownHandler: (event: KeyboardEvent) => void;
  private visible = false;
  private review: ReplayReviewData | null = null;
  private currentFrameIndex = 0;
  private currentPaused = true;
  private currentSpeed = 1;

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
    body.append(frameDataPanel, eventPanel);

    this.root.append(header, controls, jumpRow, timelineWrap, body);
    document.body.appendChild(this.root);

    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.visible) {
        return;
      }
      const key = event.key.toLowerCase();
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
  }

  isVisible(): boolean {
    return this.visible;
  }

  updatePlayback(frameIndex: number, paused: boolean, speed: number): void {
    if (!this.review) {
      return;
    }
    const clampedFrame = Math.max(0, Math.min(this.review.totalFrames - 1, frameIndex));
    const frame = this.review.frames[clampedFrame];
    this.currentFrameIndex = clampedFrame;
    this.currentPaused = paused;
    this.currentSpeed = speed;
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
    this.frameDataContent.innerHTML = renderFrameData(frame);
    this.eventContent.innerHTML = renderRecentEvents(this.review.frames, clampedFrame);
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
  const parts: string[] = [];
  if (input.moveY > 0.1) {
    parts.push('U');
  } else if (input.moveY < -0.1) {
    parts.push('D');
  }
  if (input.moveX > 0.1) {
    parts.push('R');
  } else if (input.moveX < -0.1) {
    parts.push('L');
  }
  if (input.boost) {
    parts.push('B');
  }
  if (input.superBoost) {
    parts.push('SB');
  }
  if (input.special) {
    parts.push('SP');
  }
  if (input.launch) {
    parts.push('LN');
  }
  if (input.dunk) {
    parts.push('DK');
  }
  if (input.parry) {
    parts.push('PR');
  }
  if (input.breakLaunch) {
    parts.push('BR');
  }
  return parts.length > 0 ? parts.join('+') : '.';
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

export function createReplayViewer(options: ReplayViewerOptions): ReplayViewerController {
  return new ReplayViewer(options);
}
