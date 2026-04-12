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
  frame: number;
  accountId: string;
  input: RelayPlayerFrameInput;
  receivedAt: string;
}

export interface SubmitRelayFramesRequest {
  sessionId: string;
  accountId: string;
  frames: Array<{
    frame: number;
    input: RelayPlayerFrameInput;
  }>;
}

export interface RelayFramesResponse {
  frames: RelayFrameEntry[];
}

interface SessionRelayState {
  framesByAccount: Map<string, Map<number, RelayFrameEntry>>;
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
      accountFrames.set(frame.frame, {
        frame: frame.frame,
        accountId: request.accountId,
        input: cloneInput(frame.input),
        receivedAt,
      });
    }
    this.pruneAccountFrames(accountFrames);
    return request.frames.length;
  }

  public getPeerFrames(sessionId: string, accountId: string, sinceFrame: number): RelayFramesResponse {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { frames: [] };
    }
    const frames: RelayFrameEntry[] = [];
    for (const [participantAccountId, accountFrames] of session.framesByAccount.entries()) {
      if (participantAccountId === accountId) {
        continue;
      }
      for (const entry of accountFrames.values()) {
        if (entry.frame > sinceFrame) {
          frames.push({
            frame: entry.frame,
            accountId: entry.accountId,
            input: cloneInput(entry.input),
            receivedAt: entry.receivedAt,
          });
        }
      }
    }
    frames.sort((a, b) => a.frame - b.frame);
    return { frames };
  }

  public clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private ensureSession(sessionId: string): SessionRelayState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        framesByAccount: new Map<string, Map<number, RelayFrameEntry>>(),
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private ensureAccountFrames(session: SessionRelayState, accountId: string): Map<number, RelayFrameEntry> {
    let frames = session.framesByAccount.get(accountId);
    if (!frames) {
      frames = new Map<number, RelayFrameEntry>();
      session.framesByAccount.set(accountId, frames);
    }
    return frames;
  }

  private pruneAccountFrames(accountFrames: Map<number, RelayFrameEntry>): void {
    if (accountFrames.size <= this.maxFramesPerAccount) {
      return;
    }
    const orderedFrames = [...accountFrames.keys()].sort((a, b) => a - b);
    const excess = orderedFrames.length - this.maxFramesPerAccount;
    for (let index = 0; index < excess; index += 1) {
      accountFrames.delete(orderedFrames[index]);
    }
  }
}

export function createLiveSessionFrameRelay(options: LiveSessionFrameRelayOptions = {}): LiveSessionFrameRelay {
  return new LiveSessionFrameRelay(options);
}
