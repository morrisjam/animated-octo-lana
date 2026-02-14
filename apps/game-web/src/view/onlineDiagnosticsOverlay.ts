import type { RollbackDiagnosticsView } from './hud';

export interface OnlineDiagnosticsSnapshot {
  capturedAt: string;
  build: string;
  rulesetVersion: string;
  accountId: string | null;
  participantAccountIds: string[];
  sessionId: string | null;
  ticketId: string | null;
  queueType: string | null;
  region: string | null;
  queueWaitMs: number | null;
  connectionPath: 'direct' | 'relay' | 'unknown';
  rttMs: number | null;
  packetLossPercent: number | null;
  rollback: RollbackDiagnosticsView | null;
}

export interface OnlineDiagnosticsOverlayController {
  update(snapshot: OnlineDiagnosticsSnapshot): void;
  dispose(): void;
}

class OnlineDiagnosticsOverlay implements OnlineDiagnosticsOverlayController {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly body: HTMLPreElement;
  private latestSnapshot: OnlineDiagnosticsSnapshot | null = null;

  public constructor() {
    this.root = document.createElement('div');
    this.root.className = 'online-diagnostics-overlay';

    const header = document.createElement('div');
    header.className = 'online-diagnostics-header';

    const title = document.createElement('strong');
    title.textContent = 'Online Diagnostics';
    header.appendChild(title);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'online-diagnostics-export';
    exportButton.textContent = 'Export JSON';
    exportButton.addEventListener('click', () => {
      void this.copySnapshot();
    });
    header.appendChild(exportButton);

    this.status = document.createElement('div');
    this.status.className = 'online-diagnostics-status';
    this.status.textContent = 'Waiting for diagnostics data.';

    this.body = document.createElement('pre');
    this.body.className = 'online-diagnostics-body';
    this.body.textContent = '-';

    this.root.append(header, this.status, this.body);
    document.body.appendChild(this.root);
  }

  public update(snapshot: OnlineDiagnosticsSnapshot): void {
    this.latestSnapshot = snapshot;
    const queueWaitSeconds = snapshot.queueWaitMs === null ? null : Number((snapshot.queueWaitMs / 1000).toFixed(2));
    this.body.textContent = JSON.stringify({
      capturedAt: snapshot.capturedAt,
      build: snapshot.build,
      rulesetVersion: snapshot.rulesetVersion,
      accountIds: {
        local: snapshot.accountId,
        participants: snapshot.participantAccountIds,
      },
      session: {
        ticketId: snapshot.ticketId,
        sessionId: snapshot.sessionId,
        queueType: snapshot.queueType,
        region: snapshot.region,
        queueWaitSeconds,
      },
      network: {
        connectionPath: snapshot.connectionPath,
        rttMs: snapshot.rttMs,
        packetLossPercent: snapshot.packetLossPercent,
      },
      rollback: snapshot.rollback,
    }, null, 2);
    this.status.textContent = 'Diagnostics live.';
  }

  public dispose(): void {
    this.root.remove();
  }

  private async copySnapshot(): Promise<void> {
    if (!this.latestSnapshot) {
      this.status.textContent = 'Nothing to export yet.';
      return;
    }
    const text = JSON.stringify(this.latestSnapshot, null, 2);
    const copied = await this.copyToClipboard(text);
    this.status.textContent = copied
      ? `Exported diagnostics at ${new Date().toLocaleTimeString()}.`
      : 'Clipboard export failed. Browser denied access.';
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      return false;
    }
    try {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.focus();
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

export function createOnlineDiagnosticsOverlay(): OnlineDiagnosticsOverlayController {
  return new OnlineDiagnosticsOverlay();
}
