import type { CombatReadabilityTracker } from './readabilityTracker';

export function createLazyCombatReadabilityTracker(
  load: () => Promise<CombatReadabilityTracker> = async () => (
    await import('./readabilityTracker')
  ).createCombatReadabilityTracker(),
): CombatReadabilityTracker {
  let tracker: CombatReadabilityTracker | null = null;
  let requested = false;
  return {
    reset: () => { tracker?.reset(); },
    recordFrame(state, starts) {
      if (tracker) return tracker.recordFrame(state, starts);
      if (!requested) {
        requested = true;
        // Never replay frames captured before loading or fabricate an outcome.
        void load().then((loaded) => { tracker = loaded; }).catch(() => {});
      }
      return [];
    },
  };
}
