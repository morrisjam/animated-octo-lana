import type { PlayerFrameInput } from '../sim/types';
import type {
  RemoteAuthoritativeBatchApplyResult,
  RemoteAuthoritativeFrameInput,
  RollbackSession,
} from './rollbackSession';

export interface RemoteInputBatchResult {
  appliedFrames: number[];
  rollbackFrames: number;
  duplicateFrames: number[];
  conflictingFrames: number[];
  tooLateFrames: number[];
}

type RemoteInputSink = Pick<RollbackSession, 'applyRemoteAuthoritativeInputs'>;

export function applyPendingRemoteInputs(
  pendingInputs: Map<number, PlayerFrameInput>,
  sink: RemoteInputSink,
  throughFrame: number,
): RemoteInputBatchResult {
  if (!Number.isInteger(throughFrame) || throughFrame < 0) {
    throw new Error(`throughFrame must be a non-negative integer. Received: ${throughFrame}`);
  }

  const inputs: RemoteAuthoritativeFrameInput[] = [...pendingInputs.entries()]
    .filter(([frame]) => frame <= throughFrame)
    .sort(([firstFrame], [secondFrame]) => firstFrame - secondFrame)
    .map(([frame, input]) => ({ frame, input }));

  if (inputs.length === 0) {
    return {
      appliedFrames: [],
      rollbackFrames: 0,
      duplicateFrames: [],
      conflictingFrames: [],
      tooLateFrames: [],
    };
  }

  const applyResult: RemoteAuthoritativeBatchApplyResult = sink.applyRemoteAuthoritativeInputs(inputs);
  for (const { frame } of inputs) {
    pendingInputs.delete(frame);
  }
  return {
    appliedFrames: applyResult.acceptedFrames,
    rollbackFrames: applyResult.rollbackFrames,
    duplicateFrames: applyResult.duplicateFrames,
    conflictingFrames: applyResult.conflictingFrames,
    tooLateFrames: applyResult.tooLateFrames,
  };
}
