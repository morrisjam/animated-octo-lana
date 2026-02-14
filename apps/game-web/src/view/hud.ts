import { CHARACTER_BY_ID } from '../sim/characters';
import type { RenderSnapshot } from '../sim/types';

interface HudElements {
  p1Fuel: HTMLDivElement;
  p2Fuel: HTMLDivElement;
  p1Breaks: HTMLDivElement;
  p2Breaks: HTMLDivElement;
  status: HTMLDivElement;
  frameData: HTMLDivElement;
  rollbackDiagnostics: HTMLDivElement;
}

export interface RollbackDiagnosticsView {
  totalFramesSimulated: number;
  predictedRemoteFrames: number;
  authoritativeRemoteFrames: number;
  totalRollbacks: number;
  maxRollbackDepth: number;
  lastRollbackDepth: number;
  lastRollbackFromFrame: number | null;
  desyncEventCount: number;
}

export interface HudController {
  update(snapshot: RenderSnapshot): void;
  setTrainingFrameDataVisible(visible: boolean): void;
  setRollbackDiagnosticsVisible(visible: boolean): void;
  updateRollbackDiagnostics(diagnostics: RollbackDiagnosticsView | null): void;
}

const MAX_BREAK_ICONS = 3;

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
  const elements: HudElements = {
    p1Fuel: getRequiredElement<HTMLDivElement>('#p1Fuel'),
    p2Fuel: getRequiredElement<HTMLDivElement>('#p2Fuel'),
    p1Breaks: getRequiredElement<HTMLDivElement>('#p1Breaks'),
    p2Breaks: getRequiredElement<HTMLDivElement>('#p2Breaks'),
    status: getRequiredElement<HTMLDivElement>('#status'),
    frameData: getRequiredElement<HTMLDivElement>('#frameData'),
    rollbackDiagnostics: getRequiredElement<HTMLDivElement>('#rollbackDiagnostics'),
  };
  elements.frameData.hidden = true;
  elements.rollbackDiagnostics.hidden = true;

  return {
    setTrainingFrameDataVisible(visible: boolean): void {
      elements.frameData.hidden = !visible;
    },
    setRollbackDiagnosticsVisible(visible: boolean): void {
      elements.rollbackDiagnostics.hidden = !visible;
    },
    updateRollbackDiagnostics(diagnostics: RollbackDiagnosticsView | null): void {
      if (!diagnostics) {
        elements.rollbackDiagnostics.innerHTML = '';
        return;
      }
      const remoteResolvedFrames = diagnostics.predictedRemoteFrames + diagnostics.authoritativeRemoteFrames;
      const predictedRatio = remoteResolvedFrames > 0
        ? Math.round((diagnostics.predictedRemoteFrames / remoteResolvedFrames) * 100)
        : 0;
      elements.rollbackDiagnostics.innerHTML = `
        <div class="title">Rollback Diagnostics</div>
        <div class="row">Frames: ${diagnostics.totalFramesSimulated} | Predicted remote: ${diagnostics.predictedRemoteFrames} (${predictedRatio}%) | Authoritative remote: ${diagnostics.authoritativeRemoteFrames}</div>
        <div class="row">Rollbacks: ${diagnostics.totalRollbacks} | Max depth: ${diagnostics.maxRollbackDepth} | Last depth: ${diagnostics.lastRollbackDepth}</div>
        <div class="row">Last rollback frame: ${diagnostics.lastRollbackFromFrame ?? '-'} | Desync events: ${diagnostics.desyncEventCount}</div>
      `;
    },
    update(snapshot: RenderSnapshot): void {
      const p1 = snapshot.players.P1;
      const p2 = snapshot.players.P2;
      const p1MoveData = CHARACTER_BY_ID[p1.characterId].moves.launch;
      const p2MoveData = CHARACTER_BY_ID[p2.characterId].moves.launch;

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

      elements.frameData.innerHTML = `
        <div class="title">Training Frame Data</div>
        <div class="row">P1 ${CHARACTER_BY_ID[p1.characterId].displayName} launch: ${p1MoveData.startupFrames}f startup, ${p1MoveData.activeFrames}f active, ${p1MoveData.recoveryOnWhiffFrames}f whiff recover</div>
        <div class="row">P2 ${CHARACTER_BY_ID[p2.characterId].displayName} launch: ${p2MoveData.startupFrames}f startup, ${p2MoveData.activeFrames}f active, ${p2MoveData.recoveryOnWhiffFrames}f whiff recover</div>
      `;
    },
  };
}
