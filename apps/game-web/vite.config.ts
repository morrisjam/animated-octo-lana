import { execFileSync } from 'node:child_process';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { localFlowReviewVitePlugin } from './scripts/local-flow-review-vite-plugin';
import { replayFixturesVitePlugin } from './scripts/replay-fixtures-vite-plugin';
import { createLocalRankedRootSmokeBuildAttestation } from './src/build/localRankedRootSmokeBuild';
import {
  resolveCloudflarePagesReleaseBuild,
  WEB_RELEASE_ATTESTATION_FILE_NAME,
  WEB_RELEASE_HEADERS_FILE_NAME,
} from './src/build/webReleaseAttestation';
import {
  resolveSteamAlphaReleaseAttestation,
  STEAM_ALPHA_RELEASE_FILE_NAME,
} from './src/build/steamAlphaReleaseAttestation';

type BuildEnvironment = Record<string, string | undefined>;

const environmentRoot = fileURLToPath(new URL('../..', import.meta.url));
const repositoryRoot = environmentRoot;

function readRepositorySha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
}

function repositoryIsDirty(): boolean {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim().length > 0;
}

function cloudflarePagesReleaseAttestationPlugin(environment: BuildEnvironment): Plugin {
  const releaseBuild = resolveCloudflarePagesReleaseBuild({
    cfPages: environment.CF_PAGES,
    cfPagesCommitSha: environment.CF_PAGES_COMMIT_SHA,
    configuredBuildId: environment.VITE_APP_BUILD,
    localRankedRootSmoke: environment.VITE_LOCAL_RANKED_ROOT_SMOKE,
  });
  return {
    name: 'gravity-well-cloudflare-pages-release-attestation',
    apply: 'build',
    config() {
      if (!releaseBuild) {
        return;
      }
      return {
        define: {
          'import.meta.env.VITE_APP_BUILD': JSON.stringify(releaseBuild.releaseSha),
        },
      };
    },
    generateBundle() {
      if (!releaseBuild) {
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: WEB_RELEASE_ATTESTATION_FILE_NAME,
        source: releaseBuild.attestationSource,
      });
      this.emitFile({
        type: 'asset',
        fileName: WEB_RELEASE_HEADERS_FILE_NAME,
        source: releaseBuild.headersSource,
      });
    },
  };
}

function localRankedRootSmokeBuildAttestationPlugin(environment: BuildEnvironment): Plugin {
  const enabled = String(environment.VITE_LOCAL_RANKED_ROOT_SMOKE ?? '').toLowerCase() === 'true';
  return {
    name: 'gravity-well-local-ranked-root-smoke-build-attestation',
    apply: 'build',
    generateBundle() {
      if (!enabled) {
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: 'local-ranked-root-smoke-build.json',
        source: `${JSON.stringify(createLocalRankedRootSmokeBuildAttestation({
          buildId: String(environment.VITE_APP_BUILD ?? '').trim(),
          apiBaseUrl: String(
            environment.VITE_MATCHMAKING_API_BASE
              ?? environment.VITE_PROFILE_API_BASE
              ?? '',
          ),
        }), null, 2)}\n`,
      });
    },
  };
}

function steamAlphaReleaseAttestationPlugin(
  mode: string,
  environment: BuildEnvironment,
): Plugin {
  const repositorySha = mode === 'steam-alpha' ? readRepositorySha() : undefined;
  const attestation = resolveSteamAlphaReleaseAttestation({
    mode,
    repositorySha,
    releaseSha: environment.STEAM_RELEASE_COMMIT_SHA ?? environment.GITHUB_SHA ?? repositorySha,
    configuredBuildId: environment.VITE_APP_BUILD,
    sourceDirty: mode === 'steam-alpha' ? repositoryIsDirty() : false,
    requireCleanRelease: environment.STEAM_REQUIRE_CLEAN_RELEASE,
    cfPages: environment.CF_PAGES,
    appEnvironment: environment.VITE_APP_ENV,
    platform: environment.VITE_PLATFORM,
    profileApiBase: environment.VITE_PROFILE_API_BASE,
    matchmakingApiBase: environment.VITE_MATCHMAKING_API_BASE,
    rulesetVersion: environment.VITE_RULESET_VERSION,
    balanceProfileId: environment.VITE_BALANCE_PROFILE_ID,
    steamWebApiIdentity: environment.VITE_STEAM_WEB_API_IDENTITY,
    entitlementMode: environment.VITE_STEAM_ENTITLEMENT_MODE,
    entitlementBypass: environment.VITE_STEAM_ENTITLEMENT_BYPASS,
    developmentTicket: environment.VITE_STEAM_DEV_TICKET,
    online: environment.VITE_FEATURE_ONLINE,
    ranked: environment.VITE_FEATURE_RANKED,
    onlineMatchRuntime: environment.VITE_FEATURE_ONLINE_MATCH_RUNTIME,
    debugTools: environment.VITE_FEATURE_DEBUG_TOOLS,
    onlineDiagnostics: environment.VITE_FEATURE_ONLINE_DIAGNOSTICS,
    onlineDevMenu: environment.VITE_FEATURE_ONLINE_DEV_MENU,
    trainingMode: environment.VITE_FEATURE_TRAINING_MODE,
    arcadeMode: environment.VITE_FEATURE_ARCADE_MODE,
    localRankedRootSmoke: environment.VITE_LOCAL_RANKED_ROOT_SMOKE,
  });
  return {
    name: 'gravity-well-steam-alpha-release-attestation',
    apply: 'build',
    config() {
      if (!attestation) {
        return;
      }
      return {
        define: {
          'import.meta.env.VITE_APP_BUILD': JSON.stringify(attestation.releaseSha),
        },
      };
    },
    generateBundle() {
      if (!attestation) {
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: STEAM_ALPHA_RELEASE_FILE_NAME,
        source: `${JSON.stringify(attestation, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment: BuildEnvironment = {
    ...loadEnv(mode, environmentRoot, ''),
    ...process.env,
  };
  const gameEntry = fileURLToPath(new URL('index.html', import.meta.url));
  const buildInput = mode === 'steam-alpha'
    ? { game: gameEntry }
    : {
        game: gameEntry,
        webRtcSmoke: fileURLToPath(new URL('webrtc-smoke.html', import.meta.url)),
        webRtcPeerSmoke: fileURLToPath(new URL('webrtc-peer-smoke.html', import.meta.url)),
      };
  return {
    envDir: '../..',
    plugins: [
      localFlowReviewVitePlugin(),
      replayFixturesVitePlugin(),
      localRankedRootSmokeBuildAttestationPlugin(environment),
      cloudflarePagesReleaseAttestationPlugin(environment),
      steamAlphaReleaseAttestationPlugin(mode, environment),
    ],
    server: {
      watch: {
        ignored: [
          '**/build-artifacts/**',
          '**/steam-artifact/**',
        ],
      },
    },
    build: {
      rollupOptions: {
        input: buildInput,
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');
            if (normalizedId.includes('/node_modules/three/')) {
              return 'three';
            }
            if (normalizedId.endsWith('/src/input/bindings.ts')) {
              // Reuse an existing initial chunk instead of paying for another module preload.
              return 'onlineRuntime';
            }
            if (normalizedId.includes('/src/net/')) {
              return 'onlineRuntime';
            }
            return undefined;
          },
        },
      },
    },
  };
});
