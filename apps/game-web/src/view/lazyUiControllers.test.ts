import { describe, expect, test, vi } from 'vitest';
import type { ReplayReviewData } from '../sim/replayReview';
import type { OnlineDevMenu, OnlineDevMenuOptions } from './onlineDevMenu';
import type { PauseMenu, PauseMenuOptions } from './pauseMenu';
import type {
  ReplayViewerComparisonContext,
  ReplayViewerController,
  ReplayViewerOptions,
} from './replayViewer';
import {
  createLazyOnlineDevMenu,
  createLazyPauseMenu,
  createLazyReplayViewer,
} from './lazyUiControllers';

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPauseMenuDouble() {
  let paused = false;
  const menu = {
    isPaused: vi.fn(() => paused),
    isCapturingBinding: vi.fn(() => false),
    toggle: vi.fn(),
    setPaused: vi.fn((nextPaused: boolean) => {
      paused = nextPaused;
    }),
    openBalanceLab: vi.fn(() => {
      paused = true;
    }),
    openBindings: vi.fn(() => {
      paused = true;
    }),
    setCanRestartTraining: vi.fn(),
    setBalanceLabAvailable: vi.fn(),
  } as unknown as PauseMenu;
  return menu;
}

function createReplayViewerDouble(): ReplayViewerController {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn(() => false),
    updatePlayback: vi.fn(),
    dispose: vi.fn(),
  };
}

function createOnlineDevMenuDouble() {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  } as unknown as OnlineDevMenu;
}

describe('lazy UI controllers', () => {
  test('pauses synchronously and replays queued Balance Lab state after loading', async () => {
    const moduleLoad = deferred<{ createPauseMenu: () => PauseMenu }>();
    const menu = createPauseMenuDouble();
    const controller = createLazyPauseMenu(
      { enableDebugTab: false } as PauseMenuOptions,
      {},
      () => moduleLoad.promise,
    );

    controller.setCanRestartTraining(true);
    controller.setBalanceLabAvailable(true);
    controller.openBalanceLab('Matched sample complete.');

    expect(controller.isPaused()).toBe(true);
    expect(menu.openBalanceLab).not.toHaveBeenCalled();

    moduleLoad.resolve({ createPauseMenu: () => menu });
    await controller.preload();

    expect(menu.setCanRestartTraining).toHaveBeenCalledWith(true);
    expect(menu.setBalanceLabAvailable).toHaveBeenCalledWith(true);
    expect(menu.setPaused).toHaveBeenCalledWith(true);
    expect(menu.openBalanceLab).toHaveBeenCalledWith('Matched sample complete.');

    menu.setPaused(false);
    expect(controller.isPaused()).toBe(false);
    controller.toggle();
    expect(controller.isPaused()).toBe(true);
  });

  test('unpauses after a failed pause-menu load and permits a clean retry', async () => {
    const failure = new Error('chunk unavailable');
    const menu = createPauseMenuDouble();
    const onLoadError = vi.fn();
    let attempts = 0;
    const controller = createLazyPauseMenu(
      {} as PauseMenuOptions,
      { onLoadError },
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw failure;
        }
        return { createPauseMenu: () => menu };
      },
    );

    controller.toggle();
    await vi.waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
    expect(controller.isPaused()).toBe(false);
    expect(onLoadError).toHaveBeenCalledWith('pause_menu', failure);

    controller.toggle();
    await controller.preload();
    expect(attempts).toBe(2);
    expect(controller.isPaused()).toBe(true);
    expect(menu.setPaused).toHaveBeenCalledWith(true);
  });

  test('queues the controls editor while the pause chunk loads', async () => {
    const moduleLoad = deferred<{ createPauseMenu: () => PauseMenu }>();
    const menu = createPauseMenuDouble();
    const controller = createLazyPauseMenu(
      {} as PauseMenuOptions,
      {},
      () => moduleLoad.promise,
    );

    controller.openBindings();
    expect(controller.isPaused()).toBe(true);
    expect(menu.openBindings).not.toHaveBeenCalled();

    moduleLoad.resolve({ createPauseMenu: () => menu });
    await controller.preload();

    expect(menu.openBindings).toHaveBeenCalledTimes(1);
    expect(controller.isCapturingBinding()).toBe(false);
  });

  test('does not flash a replay that was hidden while its chunk loaded', async () => {
    const moduleLoad = deferred<{ createReplayViewer: () => ReplayViewerController }>();
    const viewer = createReplayViewerDouble();
    const review = { totalFrames: 10 } as ReplayReviewData;
    const controller = createLazyReplayViewer(
      {} as ReplayViewerOptions,
      {},
      () => moduleLoad.promise,
    );

    controller.show(review, 'queued replay');
    controller.updatePlayback(4, true, 0.5);
    controller.hide();
    moduleLoad.resolve({ createReplayViewer: () => viewer });
    await controller.preload();

    expect(viewer.show).not.toHaveBeenCalled();
    controller.show(review, 'visible replay');
    expect(viewer.show).toHaveBeenCalledWith(review, 'visible replay');
    expect(viewer.updatePlayback).toHaveBeenCalledWith(4, true, 0.5);

    const comparison: ReplayViewerComparisonContext = {
      activeVariant: 'candidate',
      candidateAvailable: true,
      ruleChangeLabel: 'Clash Separation: 10 -> 12',
      initialFrame: 4,
    };
    controller.show(review, 'candidate replay', comparison);
    expect(viewer.show).toHaveBeenLastCalledWith(review, 'candidate replay', comparison);
  });

  test('queues the requested online section and disposes the loaded controller', async () => {
    const moduleLoad = deferred<{ createOnlineDevMenu: () => OnlineDevMenu }>();
    const menu = createOnlineDevMenuDouble();
    const controller = createLazyOnlineDevMenu(
      {} as OnlineDevMenuOptions,
      {},
      () => moduleLoad.promise,
    );

    controller.show('ranked');
    moduleLoad.resolve({ createOnlineDevMenu: () => menu });
    await controller.preload();

    expect(menu.show).toHaveBeenCalledWith('ranked');
    controller.hide();
    expect(menu.hide).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(menu.dispose).toHaveBeenCalledTimes(1);
  });
});
