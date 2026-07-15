export interface RelayPlayerFrameInput {
  moveX: number;
  moveY: number;
  boost: boolean;
  superBoost: boolean;
  special: boolean;
  launch: boolean;
  dunk: boolean;
  parry: boolean;
  breakLaunch: boolean;
}

export interface RelayFrameEntry {
  epoch: number;
  frame: number;
  accountId: string;
  input: RelayPlayerFrameInput;
  receivedAt: string;
}

export interface SubmitRelayFramesRequest {
  sessionId: string;
  accountId: string;
  frames: Array<{
    epoch?: number;
    frame: number;
    input: RelayPlayerFrameInput;
  }>;
}

export interface RelayFramesResponse {
  frames: RelayFrameEntry[];
  peerConfirmedThrough: number;
}

interface SessionRelayState {
  framesByAccount: Map<string, Map<string, RelayFrameEntry>>;
  confirmationsByAccount: Map<string, Map<number, number>>;
}

export interface LiveSessionFrameRelayOptions {
  now?: () => number;
  maxFramesPerAccount?: number;
}

const DEFAULT_MAX_FRAMES_PER_ACCOUNT = 60 * 60;

function cloneInput(input: RelayPlayerFrameInput): RelayPlayerFrameInput {
  return {
    moveX: input.moveX,
    moveY: input.moveY,
    boost: input.boost,
    superBoost: input.superBoost,
    special: input.special,
    launch: input.launch,
    dunk: input.dunk,
    parry: input.parry,
    breakLaunch: input.breakLaunch,
  };
}

export class LiveSessionFrameRelay {
  private readonly now: () => number;

  private readonly maxFramesPerAccount: number;

  private readonly sessions = new Map<string, SessionRelayState>();

  public constructor(options: LiveSessionFrameRelayOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxFramesPerAccount = Math.max(1, Math.floor(options.maxFramesPerAccount ?? DEFAULT_MAX_FRAMES_PER_ACCOUNT));
  }

  public submitFrames(request: SubmitRelayFramesRequest): number {
    const session = this.ensureSession(request.sessionId);
    const accountFrames = this.ensureAccountFrames(session, request.accountId);
    const receivedAt = new Date(this.now()).toISOString();
    for (const frame of request.frames) {
      const epoch = frame.epoch ?? 0;
      accountFrames.set(`${epoch}:${frame.frame}`, {
        epoch,
        frame: frame.frame,
        accountId: request.accountId,
        input: cloneInput(frame.input),
        receivedAt,
      });
    }
    this.pruneAccountFrames(accountFrames);
    return request.frames.length;
  }

  public getPeerFrames(
    sessionId: string,
    accountId: string,
    epoch: number,
    sinceFrame: number,
  ): RelayFramesResponse {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { frames: [], peerConfirmedThrough: -1 };
    }
    const frames: RelayFrameEntry[] = [];
    for (const [participantAccountId, accountFrames] of session.framesByAccount.entries()) {
      if (participantAccountId === accountId) {
        continue;
      }
      for (const entry of accountFrames.values()) {
        if (entry.epoch === epoch && entry.frame > sinceFrame) {
          frames.push({
            epoch: entry.epoch,
            frame: entry.frame,
            accountId: entry.accountId,
            input: cloneInput(entry.input),
            receivedAt: entry.receivedAt,
          });
        }
      }
    }
    frames.sort((a, b) => a.frame - b.frame);
    let peerConfirmedThrough = -1;
    for (const [participantAccountId, confirmations] of session.confirmationsByAccount.entries()) {
      if (participantAccountId !== accountId) {
        peerConfirmedThrough = Math.max(peerConfirmedThrough, confirmations.get(epoch) ?? -1);
      }
    }
    return { frames, peerConfirmedThrough };
  }

  public confirmPeerFrames(
    sessionId: string,
    accountId: string,
    epoch: number,
    confirmedThrough: number,
  ): number {
    const session = this.ensureSession(sessionId);
    let confirmations = session.confirmationsByAccount.get(accountId);
    if (!confirmations) {
      confirmations = new Map<number, number>();
      session.confirmationsByAccount.set(accountId, confirmations);
    }
    const nextConfirmedThrough = Math.max(confirmations.get(epoch) ?? -1, confirmedThrough);
    confirmations.set(epoch, nextConfirmedThrough);
    return nextConfirmedThrough;
  }

  public clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private ensureSession(sessionId: string): SessionRelayState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        framesByAccount: new Map<string, Map<string, RelayFrameEntry>>(),
        confirmationsByAccount: new Map<string, Map<number, number>>(),
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private ensureAccountFrames(session: SessionRelayState, accountId: string): Map<string, RelayFrameEntry> {
    let frames = session.framesByAccount.get(accountId);
    if (!frames) {
      frames = new Map<string, RelayFrameEntry>();
      session.framesByAccount.set(accountId, frames);
    }
    return frames;
  }

  private pruneAccountFrames(accountFrames: Map<string, RelayFrameEntry>): void {
    if (accountFrames.size <= this.maxFramesPerAccount) {
      return;
    }
    const orderedFrames = [...accountFrames.entries()].sort(([, first], [, second]) => (
      first.epoch - second.epoch || first.frame - second.frame
    ));
    const excess = orderedFrames.length - this.maxFramesPerAccount;
    for (let index = 0; index < excess; index += 1) {
      const key = orderedFrames[index]?.[0];
      if (key !== undefined) {
        accountFrames.delete(key);
      }
    }
  }
}

export function createLiveSessionFrameRelay(options: LiveSessionFrameRelayOptions = {}): LiveSessionFrameRelay {
  return new LiveSessionFrameRelay(options);
}
