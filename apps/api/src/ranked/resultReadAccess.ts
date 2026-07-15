import type { RankedTerminalDecision } from './terminalDecisionStore';

export interface RankedResultParticipantPair {
  participantP1AccountId: string;
  participantP2AccountId: string;
}

export interface DurableRankedResultAccess {
  hasDurableRecord: boolean;
  authorized: boolean;
}

export function resolveDurableRankedResultAccess(
  accountId: string,
  terminalDecision: RankedTerminalDecision | null,
  settledMatch: RankedResultParticipantPair | null,
): DurableRankedResultAccess {
  const terminalParticipants = terminalDecision
    ? {
      participantP1AccountId: terminalDecision.participantP1AccountId,
      participantP2AccountId: terminalDecision.participantP2AccountId,
    }
    : null;

  if (
    terminalParticipants
    && settledMatch
    && (
      terminalParticipants.participantP1AccountId !== settledMatch.participantP1AccountId
      || terminalParticipants.participantP2AccountId !== settledMatch.participantP2AccountId
    )
  ) {
    throw new Error('Durable ranked result records disagree about session participants.');
  }

  const participants = terminalParticipants ?? settledMatch;
  if (!participants) {
    return { hasDurableRecord: false, authorized: false };
  }
  return {
    hasDurableRecord: true,
    authorized: accountId === participants.participantP1AccountId
      || accountId === participants.participantP2AccountId,
  };
}
