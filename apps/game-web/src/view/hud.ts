import type { RenderSnapshot } from '../sim/types';
import type { MatchTelemetrySummary } from '../sim/matchTelemetry';
import { buildTrainingFrameDataModel } from './trainingFrameData';
import type { InputHistoryView } from './inputHistory';

interface HudElements {
  root: HTMLDivElement;
  p1Fuel: HTMLDivElement;
  p2Fuel: HTMLDivElement;
  p1Breaks: HTMLDivElement;
  p2Breaks: HTMLDivElement;
  status: HTMLDivElement;
  controls: HTMLDivElement;
  frameData: HTMLDivElement;
  rollbackDiagnostics: HTMLDivElement;
  p1InputHistory: HTMLDivElement;
  p2InputHistory: HTMLDivElement;
  matchTelemetry: HTMLDivElement;
  analysisToggle: HTMLButtonElement;
  voiceSubtitle: HTMLDivElement;
}

export interface RollbackDiagnosticsView {
  totalFramesSimulated: number;
  predictedRemoteFrames: number;
  authoritativeRemoteFrames: number;
  totalRollbacks: number;
  maxRollbackDepth: number;
  lastRollbackDepth: number;
  lastRollbackFromFrame: number | null;
  correctionEventCount: number;
}

export interface RuntimeMemoryDiagnosticsView {
  assetBytesLoaded: number;
  textureBytesBudgeted: number;
  meshTrianglesBudgeted: number;
  vfxBudgeted: number;
  vfxActive: number;
  projectilesActive: number;
  audioEventsRouted: number;
  audioMissingRoutes: number;
}

export interface HudController {
  update(snapshot: RenderSnapshot): void;
  setTrainingFrameDataVisible(visible: boolean): void;
  setControlsVisible(visible: boolean): void;
  setRollbackDiagnosticsVisible(visible: boolean): void;
  setInputHistoryVisible(visible: boolean): void;
  setMatchTelemetryVisible(visible: boolean): void;
  setVoiceSubtitlesEnabled(enabled: boolean): void;
  showVoiceSubtitle(text: string): void;
  updateInputHistory(view: InputHistoryView | null): void;
  updateMatchTelemetry(summary: MatchTelemetrySummary | null): void;
  updateRollbackDiagnostics(
    diagnostics: RollbackDiagnosticsView | null,
    memoryDiagnostics?: RuntimeMemoryDiagnosticsView | null,
  ): void;
}

const MAX_BREAK_ICONS = 3;
const ANALYSIS_HUD_STORAGE_KEY = 'gravity_well.analysis_hud.hidden.v1';

function readAnalysisHudHidden(): boolean {
  try {
    return sessionStorage.getItem(ANALYSIS_HUD_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function storeAnalysisHudHidden(hidden: boolean): void {
  try {
    sessionStorage.setItem(ANALYSIS_HUD_STORAGE_KEY, String(hidden));
  } catch {
    // Analysis HUD visibility is non-critical when storage is unavailable.
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toFuelPercent(fuel: number, maxFuel: number): number {
  if (maxFuel <= 0) {
    return 0;
  }
  return clampPercent((fuel / maxFuel) * 100);
}

function formatBreakIcons(breaks: number): string {
  const clamped = Math.max(0, Math.min(MAX_BREAK_ICONS, Math.floor(breaks)));
  const filled = '[*]'.repeat(clamped);
  const empty = '[ ]'.repeat(MAX_BREAK_ICONS - clamped);
  return `${filled}${empty}`;
}

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing HUD element: ${selector}`);
  }
  return element;
}

export function createHud(): HudController {
  const root = getRequiredElement<HTMLDivElement>('#hud');
  const p1InputHistory = document.createElement('div');
  p1InputHistory.className = 'input-history-panel p1';
  p1InputHistory.hidden = true;
  root.appendChild(p1InputHistory);

  const p2InputHistory = document.createElement('div');
  p2InputHistory.className = 'input-history-panel p2';
  p2InputHistory.hidden = true;
  root.appendChild(p2InputHistory);

  const matchTelemetry = document.createElement('div');
  matchTelemetry.className = 'match-telemetry-panel';
  matchTelemetry.hidden = true;
  root.appendChild(matchTelemetry);

  const analysisToggle = document.createElement('button');
  analysisToggle.type = 'button';
  analysisToggle.className = 'analysis-hud-toggle';
  analysisToggle.hidden = true;
  root.appendChild(analysisToggle);

  const voiceSubtitle = document.createElement('div');
  voiceSubtitle.className = 'voice-subtitle';
  voiceSubtitle.hidden = true;
  root.appendChild(voiceSubtitle);
  const elements: HudElements = {
    root,
    p1Fuel: getRequiredElement<HTMLDivElement>('#p1Fuel'),
    p2Fuel: getRequiredElement<HTMLDivElement>('#p2Fuel'),
    p1Breaks: getRequiredElement<HTMLDivElement>('#p1Breaks'),
    p2Breaks: getRequiredElement<HTMLDivElement>('#p2Breaks'),
    status: getRequiredElement<HTMLDivElement>('#status'),
    controls: getRequiredElement<HTMLDivElement>('#controls'),
    frameData: getRequiredElement<HTMLDivElement>('#frameData'),
    rollbackDiagnostics: getRequiredElement<HTMLDivElement>('#rollbackDiagnostics'),
    p1InputHistory,
    p2InputHistory,
    matchTelemetry,
    analysisToggle,
    voiceSubtitle,
  };
  elements.frameData.hidden = true;
  elements.rollbackDiagnostics.hidden = true;
  let trainingFrameDataVisible = false;
  let voiceSubtitlesEnabled = true;
  let subtitleHideAtSeconds = 0;
  let frameDataCharacterSignature = '';
  let inputHistoryRequested = false;
  let matchTelemetryRequested = false;
  let analysisHudHidden = readAnalysisHudHidden();

  function syncAnalysisHudVisibility(): void {
    const analysisRequested = inputHistoryRequested || matchTelemetryRequested;
    elements.analysisToggle.hidden = !analysisRequested;
    elements.analysisToggle.textContent = analysisHudHidden ? 'Show Analysis HUD' : 'Hide Analysis HUD';
    elements.analysisToggle.setAttribute('aria-expanded', String(!analysisHudHidden));
    elements.p1InputHistory.hidden = !inputHistoryRequested || analysisHudHidden;
    elements.p2InputHistory.hidden = !inputHistoryRequested || analysisHudHidden;
    elements.matchTelemetry.hidden = !matchTelemetryRequested || analysisHudHidden;
  }

  elements.analysisToggle.addEventListener('click', () => {
    analysisHudHidden = !analysisHudHidden;
    storeAnalysisHudHidden(analysisHudHidden);
    syncAnalysisHudVisibility();
  });

  function renderInputHistoryPanel(
    element: HTMLDivElement,
    title: string,
    rows: InputHistoryView['P1'],
  ): void {
    const rowsHtml = rows.length > 0
      ? rows.map((row) => `<div class="input-history-row"><span class="frame">F${row.frame}</span><span class="value">${row.text}</span></div>`).join('')
      : '<div class="input-history-empty">No inputs yet.</div>';
    element.innerHTML = `
      <div class="title">${title}</div>
      <div class="input-history-body">${rowsHtml}</div>
    `;
  }

  function renderTrainingFrameData(snapshot: RenderSnapshot): void {
    const signature = `${snapshot.players.P1.characterId}|${snapshot.players.P2.characterId}`;
    if (signature === frameDataCharacterSignature) {
      return;
    }

    const model = buildTrainingFrameDataModel(snapshot.players.P1.characterId, snapshot.players.P2.characterId);
    const rowsHtml = model.rows.map((row) => `<div class="row">${row}</div>`).join('');
    elements.frameData.innerHTML = `
      <div class="title">${model.title}</div>
      <div class="row hint">${model.hint}</div>
      ${rowsHtml}
    `;
    frameDataCharacterSignature = signature;
  }

  return {
    setControlsVisible(visible: boolean): void {
      elements.controls.hidden = !visible;
      elements.root.classList.toggle('is-spectator-view', !visible);
    },
    setTrainingFrameDataVisible(visible: boolean): void {
      trainingFrameDataVisible = visible;
      elements.frameData.hidden = !visible;
      if (!visible) {
        frameDataCharacterSignature = '';
      }
    },
    setRollbackDiagnosticsVisible(visible: boolean): void {
      elements.rollbackDiagnostics.hidden = !visible;
    },
    setInputHistoryVisible(visible: boolean): void {
      inputHistoryRequested = visible;
      syncAnalysisHudVisibility();
    },
    setMatchTelemetryVisible(visible: boolean): void {
      matchTelemetryRequested = visible;
      syncAnalysisHudVisibility();
    },
    setVoiceSubtitlesEnabled(enabled: boolean): void {
      voiceSubtitlesEnabled = enabled;
      if (!enabled) {
        elements.voiceSubtitle.hidden = true;
      }
    },
    showVoiceSubtitle(text: string): void {
      if (!voiceSubtitlesEnabled || text.trim().length === 0) {
        return;
      }
      elements.voiceSubtitle.textContent = text;
      elements.voiceSubtitle.hidden = false;
      subtitleHideAtSeconds = performance.now() / 1000 + 2.4;
    },
    updateInputHistory(view: InputHistoryView | null): void {
      if (!view) {
        elements.p1InputHistory.innerHTML = '';
        elements.p2InputHistory.innerHTML = '';
        return;
      }
      renderInputHistoryPanel(elements.p1InputHistory, 'P1 Inputs', view.P1);
      renderInputHistoryPanel(elements.p2InputHistory, 'P2 Inputs', view.P2);
    },
    updateMatchTelemetry(summary: MatchTelemetrySummary | null): void {
      if (!summary) {
        elements.matchTelemetry.innerHTML = '';
        return;
      }

      const playerRows = (label: 'P1' | 'P2', accentClass: 'p1' | 'p2') => {
        const player = summary.players[label];
        const movement = player.movementIntent;
        const percent = (frames: number, total: number): number => Math.round(frames / Math.max(1, total) * 100);
        return `
          <div class="match-telemetry-column ${accentClass}">
            <div class="player-title">${label}</div>
            <div class="row">L ${player.launchStarts}/${player.launchHits} | Dk ${player.dunkStarts}/${player.dunkHits}</div>
            <div class="row">LConv ${player.launchConversionRate.toFixed(2)} | DkConv ${player.dunkConversionRate.toFixed(2)} | Clash ${player.clashCount}</div>
            <div class="row">SP ${player.specialStarts}/${player.specialResolves} | P ${player.parryStarts}</div>
            <div class="row">Br ${player.breakPresses}/${player.breakEscapes} @ ${player.averageBreakReactionSeconds.toFixed(2)}s</div>
            <div class="row">Boost ${player.boostStarts}/${player.boostFrames}f | SB ${player.superBoostStarts}/${player.superBoostFrames}f</div>
            <div class="row">Proj ${player.projectilesSpawned}/${player.projectileImpacts} impact</div>
            <div class="row">Move A/O/D/I ${percent(movement.approachFrames, movement.controllableFrames)}/${percent(movement.orbitFrames, movement.controllableFrames)}/${percent(movement.retreatFrames, movement.controllableFrames)}/${percent(movement.idleFrames, movement.controllableFrames)}%</div>
            <div class="row">Both-active close A/D ${percent(movement.contestedPointBlankApproachFrames, movement.contestedPointBlankFrames)}/${percent(movement.contestedPointBlankRetreatFrames, movement.contestedPointBlankFrames)}%</div>
          </div>
        `;
      };

      elements.matchTelemetry.innerHTML = `
        <div class="title">Match Telemetry</div>
        <div class="row hint">Frames ${summary.framesSimulated} | Time ${summary.elapsedSeconds.toFixed(2)}s | Avg dist ${summary.spacing.averageDistance.toFixed(2)}</div>
        <div class="row hint">Point blank ${summary.spacing.pointBlankSeconds.toFixed(2)}s | Pressure ${summary.spacing.pressureBandSeconds.toFixed(2)}s | Closest ${summary.spacing.closestDistance.toFixed(2)}</div>
        <div class="match-telemetry-grid">
          ${playerRows('P1', 'p1')}
          ${playerRows('P2', 'p2')}
        </div>
      `;
    },
    updateRollbackDiagnostics(
      diagnostics: RollbackDiagnosticsView | null,
      memoryDiagnostics?: RuntimeMemoryDiagnosticsView | null,
    ): void {
      if (!diagnostics && !memoryDiagnostics) {
        elements.rollbackDiagnostics.innerHTML = '';
        return;
      }
      const rows: string[] = [];
      if (diagnostics) {
        const remoteResolvedFrames = diagnostics.predictedRemoteFrames + diagnostics.authoritativeRemoteFrames;
        const predictedRatio = remoteResolvedFrames > 0
          ? Math.round((diagnostics.predictedRemoteFrames / remoteResolvedFrames) * 100)
          : 0;
        rows.push(
          `<div class="row">Frames: ${diagnostics.totalFramesSimulated} | Predicted remote: ${diagnostics.predictedRemoteFrames} (${predictedRatio}%) | Authoritative remote: ${diagnostics.authoritativeRemoteFrames}</div>`,
          `<div class="row">Rollbacks: ${diagnostics.totalRollbacks} | Max depth: ${diagnostics.maxRollbackDepth} | Last depth: ${diagnostics.lastRollbackDepth}</div>`,
          `<div class="row">Last rollback frame: ${diagnostics.lastRollbackFromFrame ?? '-'} | State corrections: ${diagnostics.correctionEventCount}</div>`,
        );
      } else {
        rows.push('<div class="row">Rollback session inactive.</div>');
      }

      if (memoryDiagnostics) {
        rows.push(
          `<div class="row">Asset bytes loaded: ${memoryDiagnostics.assetBytesLoaded} | Texture budgeted: ${memoryDiagnostics.textureBytesBudgeted} | Mesh triangles budgeted: ${memoryDiagnostics.meshTrianglesBudgeted}</div>`,
          `<div class="row">VFX emitters budgeted: ${memoryDiagnostics.vfxBudgeted} | VFX active: ${memoryDiagnostics.vfxActive} | Projectiles active: ${memoryDiagnostics.projectilesActive}</div>`,
          `<div class="row">Audio routed: ${memoryDiagnostics.audioEventsRouted} | Missing audio routes: ${memoryDiagnostics.audioMissingRoutes}</div>`,
        );
      }

      elements.rollbackDiagnostics.innerHTML = `
        <div class="title">Debug Diagnostics</div>
        ${rows.join('')}
      `;
    },
    update(snapshot: RenderSnapshot): void {
      const p1 = snapshot.players.P1;
      const p2 = snapshot.players.P2;

      elements.p1Fuel.style.width = `${toFuelPercent(p1.fuel, p1.maxFuel)}%`;
      elements.p2Fuel.style.width = `${toFuelPercent(p2.fuel, p2.maxFuel)}%`;
      elements.p1Breaks.textContent = `Breaks: ${formatBreakIcons(p1.launchBreaks)}`;
      elements.p2Breaks.textContent = `Breaks: ${formatBreakIcons(p2.launchBreaks)}`;

      elements.status.textContent = snapshot.statusText;
      if (snapshot.winner) {
        elements.status.classList.add('win');
      } else {
        elements.status.classList.remove('win');
      }
      if (trainingFrameDataVisible) {
        renderTrainingFrameData(snapshot);
      }
      if (!elements.voiceSubtitle.hidden && performance.now() / 1000 >= subtitleHideAtSeconds) {
        elements.voiceSubtitle.hidden = true;
      }
    },
  };
}
