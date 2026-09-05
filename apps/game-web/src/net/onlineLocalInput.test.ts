import { afterEach, describe, expect, test, vi } from 'vitest';
import { createInputBindingStore } from '../input/bindings';
import { ControllerOwnership } from '../input/controllerOwnership';
import { createEmptyFrameInput } from '../input/frame';
import { GamepadInput } from '../input/gamepad';
import { getOnlineLocalInput } from './onlineLocalInput';
import { OnlineInputPump } from './onlineInputPump';

afterEach(() => vi.unstubAllGlobals());

describe('online local input ownership', () => {
  test.each(['P1', 'P2'] as const)('sends the primary controller for online %s through reconnect and rematch', async (seat) => {
    const ownership = new ControllerOwnership();
    const pad = {
      axes: [0.75, -0.5],
      buttons: Array.from({ length: 17 }, () => ({ pressed: true, value: 1 })),
    } as unknown as Gamepad;
    let pads: (Gamepad | null)[] = [pad];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    ownership.connect(0);
    expect(ownership.claimAvailablePlayer(0)).toBe('P1');
    const gamepad = new GamepadInput(createInputBindingStore(), {
      getAssignments: () => ownership.getState().assignments,
    });
    const submitFrames = vi.fn(async (frames) => ({ acceptedFrames: frames.length }));
    const pump = new OnlineInputPump({
      remoteAccountId: seat === 'P1' ? 'peer-p2' : 'peer-p1',
      transport: {
        submitFrames,
        pollFrames: async () => ({ frames: [] }),
        confirmFrames: async (_epoch, confirmedThrough) => ({ confirmedThrough }),
      },
    });
    for (const epoch of [0, 1]) {
      pump.startEpoch(epoch);
      const frame = gamepad.getFrameInput();
      expect(frame.p2).toEqual(createEmptyFrameInput().p2);
      pump.enqueueLocalInput(0, getOnlineLocalInput(frame));
      await pump.flushOutgoing();
      expect(submitFrames.mock.lastCall![0][0]).toMatchObject({
        epoch, input: { moveX: 0.75, moveY: 0.5, launch: true, boost: true },
      });
      ownership.disconnect(epoch);
      pads = [];
      expect(getOnlineLocalInput(gamepad.getFrameInput()).moveX).toBe(0);
      pads = [null, pad];
      ownership.connect(1);
      ownership.claimAvailablePlayer(1);
    }
  });

  test('uses primary keyboard bindings and returns a detached snapshot', () => {
    const frame = createEmptyFrameInput();
    frame.p1.moveX = 1;
    frame.p1.breakLaunch = true;
    frame.p2.moveX = -1;
    const local = getOnlineLocalInput(frame);
    frame.p1.moveX = 0;
    expect(local).toMatchObject({ moveX: 1, breakLaunch: true });
  });
});
