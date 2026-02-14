import type { QueueType, RegionId } from './queueService';

export type ConnectionPath = 'direct' | 'relay';
export type ConnectionTransport = 'webrtc' | 'steam_sockets' | 'unknown';

export interface ConnectivityTelemetryEvent {
  accountId: string;
  queueType: QueueType;
  region: RegionId;
  connectionPath: ConnectionPath;
  transport: ConnectionTransport;
  sessionId?: string;
  rttMs?: number;
  packetLossPercent?: number;
  occurredAtMs?: number;
}

export interface ConnectivityTelemetrySummary {
  totalEvents: number;
  directCount: number;
  relayCount: number;
  byRegion: Record<RegionId, { total: number; direct: number; relay: number }>;
}

export interface ConnectivityTelemetryOptions {
  retentionMs?: number;
  now?: () => number;
}

interface StoredTelemetryEvent extends Omit<ConnectivityTelemetryEvent, 'occurredAtMs'> {
  occurredAtMs: number;
}

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

export class ConnectivityTelemetryStore {
  private readonly retentionMs: number;

  private readonly now: () => number;

  private readonly events: StoredTelemetryEvent[] = [];

  public constructor(options: ConnectivityTelemetryOptions = {}) {
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = options.now ?? (() => Date.now());
  }

  public record(event: ConnectivityTelemetryEvent): StoredTelemetryEvent {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const stored: StoredTelemetryEvent = {
      ...event,
      occurredAtMs: event.occurredAtMs ?? nowMs,
    };
    this.events.push(stored);
    return stored;
  }

  public getSummary(filters: { region?: RegionId; queueType?: QueueType } = {}): ConnectivityTelemetrySummary {
    const nowMs = this.now();
    this.cleanup(nowMs);
    const base = this.initialSummary();
    for (const event of this.events) {
      if (filters.region && event.region !== filters.region) {
        continue;
      }
      if (filters.queueType && event.queueType !== filters.queueType) {
        continue;
      }
      base.totalEvents += 1;
      base.byRegion[event.region].total += 1;
      if (event.connectionPath === 'relay') {
        base.relayCount += 1;
        base.byRegion[event.region].relay += 1;
      } else {
        base.directCount += 1;
        base.byRegion[event.region].direct += 1;
      }
    }
    return base;
  }

  private cleanup(nowMs: number): void {
    while (this.events.length > 0) {
      const first = this.events[0];
      if (nowMs - first.occurredAtMs <= this.retentionMs) {
        break;
      }
      this.events.shift();
    }
  }

  private initialSummary(): ConnectivityTelemetrySummary {
    return {
      totalEvents: 0,
      directCount: 0,
      relayCount: 0,
      byRegion: {
        'us-east': { total: 0, direct: 0, relay: 0 },
        'us-west': { total: 0, direct: 0, relay: 0 },
        'eu-west': { total: 0, direct: 0, relay: 0 },
        'ap-southeast': { total: 0, direct: 0, relay: 0 },
      },
    };
  }
}

export function createConnectivityTelemetryStore(
  options: ConnectivityTelemetryOptions = {},
): ConnectivityTelemetryStore {
  return new ConnectivityTelemetryStore(options);
}
