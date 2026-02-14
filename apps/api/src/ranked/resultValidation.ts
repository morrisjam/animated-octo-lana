export type RankedResultSuspiciousReason =
  | 'match_id_mismatch'
  | 'participants_mismatch'
  | 'submitter_not_in_payload'
  | 'winner_not_in_session';

export interface RankedResultSessionExpectation {
  sessionId: string;
  participantAccountIds: string[];
}

export interface RankedResultSubmissionInput {
  submittedByAccountId: string;
  matchId: string;
  participantAccountIds: string[];
  winnerAccountId: string | null;
}

export interface RankedResultEvaluation {
  suspicious: boolean;
  reasons: RankedResultSuspiciousReason[];
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function evaluateRankedResultSubmission(
  expectation: RankedResultSessionExpectation,
  submission: RankedResultSubmissionInput,
): RankedResultEvaluation {
  const reasons: RankedResultSuspiciousReason[] = [];

  if (submission.matchId !== expectation.sessionId) {
    reasons.push('match_id_mismatch');
  }

  const expectedParticipants = sortUnique(expectation.participantAccountIds);
  const submittedParticipants = sortUnique(submission.participantAccountIds);
  const participantsMatch = expectedParticipants.length === submittedParticipants.length
    && expectedParticipants.every((accountId, index) => accountId === submittedParticipants[index]);
  if (!participantsMatch) {
    reasons.push('participants_mismatch');
  }

  if (!submittedParticipants.includes(submission.submittedByAccountId)) {
    reasons.push('submitter_not_in_payload');
  }

  if (submission.winnerAccountId && !expectedParticipants.includes(submission.winnerAccountId)) {
    reasons.push('winner_not_in_session');
  }

  return {
    suspicious: reasons.length > 0,
    reasons,
  };
}
