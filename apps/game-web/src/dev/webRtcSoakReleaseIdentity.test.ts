import { describe, expect, test } from 'vitest';
import { resolveWebRtcSoakReleaseIdentity } from './webRtcSoakReleaseIdentity';

const RELEASE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';

describe('WebRTC soak release identity', () => {
  test('uses an exact expected SHA as the matchmaking build identity', () => {
    expect(resolveWebRtcSoakReleaseIdentity({
      expectedReleaseSha: RELEASE_SHA.toUpperCase(),
      configuredBuildVersion: RELEASE_SHA,
      fallbackBuildVersion: 'fallback',
    })).toEqual({
      buildVersion: RELEASE_SHA,
      expectedReleaseSha: RELEASE_SHA,
    });
  });

  test('rejects malformed or conflicting release identity', () => {
    expect(() => resolveWebRtcSoakReleaseIdentity({
      expectedReleaseSha: 'short',
      fallbackBuildVersion: 'fallback',
    })).toThrow(/exact Git SHA/);
    expect(() => resolveWebRtcSoakReleaseIdentity({
      expectedReleaseSha: RELEASE_SHA,
      configuredBuildVersion: '1'.repeat(40),
      fallbackBuildVersion: 'fallback',
    })).toThrow(/does not match/);
  });

  test('retains a bounded dynamic identity for ordinary local smoke runs', () => {
    expect(resolveWebRtcSoakReleaseIdentity({
      fallbackBuildVersion: 'webrtc-two-client-smoke-123',
    })).toEqual({
      buildVersion: 'webrtc-two-client-smoke-123',
      expectedReleaseSha: null,
    });
  });
});
