import type { ReplayReviewData } from '../sim/replayReview';
import type {
  OnlineDevMenu,
  OnlineDevMenuOptions,
  OnlineDevSectionId,
} from './onlineDevMenu';
import type { PauseMenu, PauseMenuOptions } from './pauseMenu';
import type {
  ReplayViewerController,
  ReplayViewerComparisonContext,
  ReplayViewerOptions,
} from './replayViewer';

export type LazyUiSurface = 'pause_menu' | 'replay_viewer' | 'online_dev_menu';

export interface LazyUiLifecycle {
  onLoadError?(surface: LazyUiSurface, error: Error): void;
}

export interface PauseMenuController {
  isPaused(): boolean;
  isCapturingBinding(): boolean;
  toggle(): void;
  setPaused(paused: boolean): void;
  openBindings(): void;
  openBalanceLab(status?: string): void;
  setCanRestartTraining(enabled: boolean): void;
  setBalanceLabAvailable(enabled: boolean): void;
  preload(): Promise<void>;
}

export interface OnlineDevMenuController {
  show(sectionId?: OnlineDevSectionId): void;
  hide(): void;
  dispose(): void;
  preload(): Promise<void>;
}

type PauseMenuModule = Pick<typeof import('./pauseMenu'), 'createPauseMenu'>;
type ReplayViewerModule = Pick<typeof import('./replayViewer'), 'createReplayViewer'>;
type OnlineDevMenuModule = Pick<typeof import('./onlineDevMenu'), 'createOnlineDevMenu'>;

type PauseMenuLoader = () => Promise<PauseMenuModule>;
type ReplayViewerLoader = () => Promise<ReplayViewerModule>;
type OnlineDevMenuLoader = () => Promise<OnlineDevMenuModule>;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createLazyPauseMenu(
  options: PauseMenuOptions,
  lifecycle: LazyUiLifecycle = {},
  loadModule: PauseMenuLoader = () => import('./pauseMenu'),
): PauseMenuController {
  let instance: PauseMenu | null = null;
  let loadPromise: Promise<PauseMenu> | null = null;
  let paused = false;
  let canRestartTraining = false;
  let balanceLabAvailable = options.enableDebugTab ?? true;
  let pendingBalanceLabStatus: string | undefined;
  let balanceLabRequested = false;
  let bindingsRequested = false;

  const ensureLoaded = (): Promise<PauseMenu> => {
    if (instance) {
      return Promise.resolve(instance);
    }
    if (!loadPromise) {
      loadPromise = loadModule()
        .then((module) => {
          const loaded = module.createPauseMenu(options);
          instance = loaded;
          loaded.setCanRestartTraining(canRestartTraining);
          loaded.setBalanceLabAvailable(balanceLabAvailable);
          loaded.setPaused(paused);
          if (bindingsRequested) {
            loaded.openBindings();
            bindingsRequested = false;
          } else if (balanceLabRequested) {
            loaded.openBalanceLab(pendingBalanceLabStatus);
            balanceLabRequested = false;
            pendingBalanceLabStatus = undefined;
          }
          return loaded;
        })
        .catch((error: unknown) => {
          loadPromise = null;
          paused = false;
          bindingsRequested = false;
          balanceLabRequested = false;
          pendingBalanceLabStatus = undefined;
          const failure = asError(error);
          lifecycle.onLoadError?.('pause_menu', failure);
          throw failure;
        });
    }
    return loadPromise;
  };

  const requestLoad = (): void => {
    void ensureLoaded().catch(() => undefined);
  };

  return {
    isPaused: () => instance?.isPaused() ?? paused,
    isCapturingBinding: () => instance?.isCapturingBinding() ?? false,
    toggle: () => {
      paused = !(instance?.isPaused() ?? paused);
      if (instance) {
        instance.setPaused(paused);
      } else if (paused) {
        requestLoad();
      }
    },
    setPaused: (nextPaused) => {
      paused = nextPaused;
      if (instance) {
        instance.setPaused(paused);
      } else if (paused) {
        requestLoad();
      }
    },
    openBindings: () => {
      paused = true;
      bindingsRequested = true;
      balanceLabRequested = false;
      pendingBalanceLabStatus = undefined;
      if (instance) {
        instance.openBindings();
        bindingsRequested = false;
      } else {
        requestLoad();
      }
    },
    openBalanceLab: (status) => {
      paused = true;
      bindingsRequested = false;
      balanceLabRequested = true;
      pendingBalanceLabStatus = status;
      if (instance) {
        instance.openBalanceLab(status);
        balanceLabRequested = false;
        pendingBalanceLabStatus = undefined;
      } else {
        requestLoad();
      }
    },
    setCanRestartTraining: (enabled) => {
      canRestartTraining = enabled;
      instance?.setCanRestartTraining(enabled);
    },
    setBalanceLabAvailable: (enabled) => {
      balanceLabAvailable = (options.enableDebugTab ?? true) || enabled;
      instance?.setBalanceLabAvailable(balanceLabAvailable);
    },
    preload: async () => {
      await ensureLoaded();
    },
  };
}

export function createLazyReplayViewer(
  options: ReplayViewerOptions,
  lifecycle: LazyUiLifecycle = {},
  loadModule: ReplayViewerLoader = () => import('./replayViewer'),
): ReplayViewerController & { preload(): Promise<void> } {
  let instance: ReplayViewerController | null = null;
  let loadPromise: Promise<ReplayViewerController> | null = null;
  let requestedVisible = false;
  let pendingReview: ReplayReviewData | null = null;
  let pendingSourceLabel = '';
  let pendingComparison: ReplayViewerComparisonContext | undefined;
  let currentFrameIndex = 0;
  let currentPaused = true;
  let currentSpeed = 1;
  let disposed = false;

  const ensureLoaded = (): Promise<ReplayViewerController> => {
    if (instance) {
      return Promise.resolve(instance);
    }
    if (disposed) {
      return Promise.reject(new Error('Replay viewer has been disposed.'));
    }
    if (!loadPromise) {
      loadPromise = loadModule()
        .then((module) => {
          if (disposed) {
            throw new Error('Replay viewer was disposed while loading.');
          }
          const loaded = module.createReplayViewer(options);
          instance = loaded;
          if (requestedVisible && pendingReview) {
            if (pendingComparison) {
              loaded.show(pendingReview, pendingSourceLabel, pendingComparison);
            } else {
              loaded.show(pendingReview, pendingSourceLabel);
            }
            loaded.updatePlayback(currentFrameIndex, currentPaused, currentSpeed);
          }
          return loaded;
        })
        .catch((error: unknown) => {
          loadPromise = null;
          requestedVisible = false;
          pendingReview = null;
          pendingSourceLabel = '';
          pendingComparison = undefined;
          const failure = asError(error);
          if (!disposed) {
            lifecycle.onLoadError?.('replay_viewer', failure);
          }
          throw failure;
        });
    }
    return loadPromise;
  };

  const requestLoad = (): void => {
    void ensureLoaded().catch(() => undefined);
  };

  return {
    show: (data, sourceLabel, comparison) => {
      requestedVisible = true;
      pendingReview = data;
      pendingSourceLabel = sourceLabel;
      pendingComparison = comparison;
      if (instance) {
        if (comparison) {
          instance.show(data, sourceLabel, comparison);
        } else {
          instance.show(data, sourceLabel);
        }
        instance.updatePlayback(currentFrameIndex, currentPaused, currentSpeed);
      } else {
        requestLoad();
      }
    },
    hide: () => {
      requestedVisible = false;
      pendingReview = null;
      pendingSourceLabel = '';
      pendingComparison = undefined;
      instance?.hide();
    },
    isVisible: () => requestedVisible,
    updatePlayback: (frameIndex, paused, speed) => {
      currentFrameIndex = frameIndex;
      currentPaused = paused;
      currentSpeed = speed;
      instance?.updatePlayback(frameIndex, paused, speed);
    },
    dispose: () => {
      disposed = true;
      requestedVisible = false;
      pendingReview = null;
      pendingComparison = undefined;
      instance?.dispose();
      instance = null;
    },
    preload: async () => {
      await ensureLoaded();
    },
  };
}

export function createLazyOnlineDevMenu(
  options: OnlineDevMenuOptions,
  lifecycle: LazyUiLifecycle = {},
  loadModule: OnlineDevMenuLoader = () => import('./onlineDevMenu'),
): OnlineDevMenuController {
  let instance: OnlineDevMenu | null = null;
  let loadPromise: Promise<OnlineDevMenu> | null = null;
  let requestedVisible = false;
  let requestedSection: OnlineDevSectionId | undefined;
  let disposed = false;

  const ensureLoaded = (): Promise<OnlineDevMenu> => {
    if (instance) {
      return Promise.resolve(instance);
    }
    if (disposed) {
      return Promise.reject(new Error('Online developer menu has been disposed.'));
    }
    if (!loadPromise) {
      loadPromise = loadModule()
        .then((module) => {
          if (disposed) {
            throw new Error('Online developer menu was disposed while loading.');
          }
          const loaded = module.createOnlineDevMenu(options);
          instance = loaded;
          if (requestedVisible) {
            loaded.show(requestedSection);
          }
          return loaded;
        })
        .catch((error: unknown) => {
          loadPromise = null;
          requestedVisible = false;
          requestedSection = undefined;
          const failure = asError(error);
          if (!disposed) {
            lifecycle.onLoadError?.('online_dev_menu', failure);
          }
          throw failure;
        });
    }
    return loadPromise;
  };

  const requestLoad = (): void => {
    void ensureLoaded().catch(() => undefined);
  };

  return {
    show: (sectionId) => {
      requestedVisible = true;
      requestedSection = sectionId;
      if (instance) {
        instance.show(sectionId);
      } else {
        requestLoad();
      }
    },
    hide: () => {
      requestedVisible = false;
      requestedSection = undefined;
      instance?.hide();
    },
    dispose: () => {
      disposed = true;
      requestedVisible = false;
      requestedSection = undefined;
      instance?.dispose();
      instance = null;
    },
    preload: async () => {
      await ensureLoaded();
    },
  };
}
