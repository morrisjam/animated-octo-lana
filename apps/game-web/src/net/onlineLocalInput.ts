import type { FrameInput, PlayerFrameInput } from '../sim/types';

// Network seats do not change this machine's primary device/binding ownership.
export function getOnlineLocalInput(input: FrameInput): PlayerFrameInput {
  return { ...input.p1 };
}
