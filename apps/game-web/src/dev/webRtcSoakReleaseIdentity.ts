const EXACT_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export interface WebRtcSoakReleaseIdentity {
  buildVersion: string;
  expectedReleaseSha: string | null;
}

export function resolveWebRtcSoakReleaseIdentity(input: {
  configuredBuildVersion?: string;
  expectedReleaseSha?: string;
  fallbackBuildVersion: string;
}): WebRtcSoakReleaseIdentity {
  const expectedReleaseSha = input.expectedReleaseSha?.trim().toLowerCase() ?? '';
  const configuredBuildVersion = input.configuredBuildVersion?.trim() ?? '';
  if (expectedReleaseSha) {
    if (!EXACT_GIT_SHA_PATTERN.test(expectedReleaseSha)) {
      throw new Error('WEBRTC_BROWSER_SMOKE_EXPECT_RELEASE_SHA must be an exact Git SHA.');
    }
    if (configuredBuildVersion && configuredBuildVersion.toLowerCase() !== expectedReleaseSha) {
      throw new Error('WebRTC soak build version does not match the expected release SHA.');
    }
    return {
      buildVersion: expectedReleaseSha,
      expectedReleaseSha,
    };
  }

  const buildVersion = configuredBuildVersion || input.fallbackBuildVersion.trim();
  if (!buildVersion || buildVersion.length > 128) {
    throw new Error('WebRTC soak build version must contain 1-128 characters.');
  }
  return {
    buildVersion,
    expectedReleaseSha: null,
  };
}
