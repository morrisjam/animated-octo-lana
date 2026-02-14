const FALLBACK_NON_ZERO_STATE = 0x6d2b79f5;
const UINT32_DIVISOR = 0x100000000;

function ensureNonZeroState(value: number): number {
  const state = value >>> 0;
  return state === 0 ? FALLBACK_NON_ZERO_STATE : state;
}

export function sanitiseSeed(seed: number | undefined): number {
  if (!Number.isFinite(seed)) {
    return FALLBACK_NON_ZERO_STATE;
  }
  return ensureNonZeroState(Math.trunc(seed as number));
}

export function nextRngState(currentState: number): number {
  let x = ensureNonZeroState(currentState);
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ensureNonZeroState(x);
}

export function rngStateToUnitFloat(state: number): number {
  return (state >>> 0) / UINT32_DIVISOR;
}
