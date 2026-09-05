import type { OnlineRankedViewState, OnlineRoomViewState } from '../view/startMenu';

interface TicketDisplay {
  ticketId: string;
  queueType: string;
  status: 'queued' | 'matched' | 'closed';
  queuedAt: string;
  closedReason?: string;
  matchStart?: {
    sessionId: string;
    diagnostics?: { skillTrack?: string; matchedGap?: number | null; expectedGap?: number | null };
  };
}

interface SessionDisplay {
  sessionId: string;
  status: string;
  participants: { accountId: string }[];
}

interface RoomDisplay {
  roomCode: string;
  status: string;
  hostAccountId: string;
  participants: { role: string }[];
  activeSession?: { sessionId: string; phase: string } | null;
}

function runtimeDetail(enabled: boolean, sessionId: string | null, phase?: string | null): string {
  return [
    `Session: ${sessionId ?? 'pending'}`,
    phase ? `Phase: ${phase}` : null,
    enabled
      ? 'Runtime: authenticated WebRTC rollback flow enabled for this build.'
      : 'Runtime: public online match entry is hidden for this build.',
  ].filter(Boolean).join('\n');
}

function rankedHint(ticket: TicketDisplay | null, session: SessionDisplay | null, enabled: boolean): string {
  if (!ticket) return 'Join queue to start searching. Refresh later if you return to this screen mid-session.';
  if (ticket.status === 'queued') return 'Stay here while searching. Refresh if the wait timer or queue state looks stale.';
  if (ticket.status === 'matched') {
    if (enabled) {
      return session?.status === 'active'
        ? 'Match accepted. The client should transition into the online session automatically.'
        : 'Session created. Stay on this screen while the browser finishes bootstrap.';
    }
    return 'This build can create ranked sessions, but the public online runtime entry is intentionally hidden.';
  }
  return 'Queue is closed. Join again to start a fresh search.';
}

export function toRankedViewState(
  ticket: TicketDisplay | null, session: SessionDisplay | null, enabled: boolean,
): OnlineRankedViewState {
  const hint = rankedHint(ticket, session, enabled);
  if (!ticket) return { headline: 'Not queued', detail: 'Press "Join Ranked Queue" to start matchmaking.', hint };
  if (ticket.status === 'queued') {
    const queuedAtMs = ticket.queuedAt ? Date.parse(ticket.queuedAt) : NaN;
    const waitLabel = Number.isFinite(queuedAtMs) ? `${Math.floor(Math.max(0, Date.now() - queuedAtMs) / 1000)}s` : 'unknown';
    return {
      headline: 'Searching for match',
      detail: `Ticket: ${ticket.ticketId}\nQueue: ${ticket.queueType}\nWait: ${waitLabel}`, hint,
    };
  }
  if (ticket.status === 'matched') {
    const diagnostics = ticket.matchStart?.diagnostics;
    return {
      headline: 'Match found (session created)',
      detail: [
        `Ticket: ${ticket.ticketId}`,
        session?.participants?.length ? `Participants: ${session.participants.map((item) => item.accountId).join(', ')}` : 'Participants: pending',
        diagnostics ? `Band: ${diagnostics.skillTrack ?? 'n/a'} | Gap: ${diagnostics.matchedGap ?? 'n/a'} / ${diagnostics.expectedGap ?? 'n/a'}` : 'Band: pending',
        runtimeDetail(enabled, ticket.matchStart?.sessionId ?? session?.sessionId ?? null, session?.status ?? null),
      ].join('\n'),
      tone: enabled ? 'success' : 'warning', hint,
    };
  }
  return { headline: 'Queue closed', detail: `Ticket: ${ticket.ticketId}\nReason: ${ticket.closedReason ?? 'closed'}`, tone: 'warning', hint };
}

function roomHint(room: RoomDisplay | null): string {
  if (!room) return 'Create a room for a private match or join with a six-character code.';
  if (room.status === 'closed') return 'This room is closed. Create a new room for another private session.';
  if (room.activeSession) {
    return room.activeSession.phase === 'in_match'
      ? 'Room session is live. Refresh if participant or session state looks stale.'
      : 'Room session is staged. Keep players in the room and refresh as the phase advances.';
  }
  return 'Share the room code with another player, then refresh once they join.';
}

export function toRoomViewState(room: RoomDisplay | null, enabled: boolean, fallbackRoomCode?: string): OnlineRoomViewState {
  const hint = roomHint(room);
  if (!room) return { headline: 'No room loaded', detail: 'Create a room or enter a code to join one.', roomCode: fallbackRoomCode ?? null, hint };
  const players = room.participants.filter((item) => item.role === 'player').length;
  const spectators = room.participants.filter((item) => item.role === 'spectator').length;
  const sessionDetail = room.activeSession ? runtimeDetail(enabled, room.activeSession.sessionId, room.activeSession.phase) : 'Session: none';
  return {
    headline: `Room ${room.roomCode} (${room.status})`,
    detail: `Host: ${room.hostAccountId}\nPlayers: ${players}\nSpectators: ${spectators}\n${sessionDetail}`,
    roomCode: room.roomCode,
    tone: room.activeSession ? 'success' : room.status === 'closed' ? 'warning' : 'neutral', hint,
  };
}
