export interface ResidentMatchmakingState {
  tickets: readonly unknown[];
  sessions: readonly unknown[];
}

export function shouldRunMatchmakingCheckpoint(
  snapshot: ResidentMatchmakingState,
  pendingTerminalDecisionCount: number,
  snapshotChanged = false,
): boolean {
  return snapshot.tickets.length > 0
    || snapshot.sessions.length > 0
    || pendingTerminalDecisionCount > 0
    || snapshotChanged;
}
