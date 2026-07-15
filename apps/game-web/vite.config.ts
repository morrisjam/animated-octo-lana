import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { localFlowReviewVitePlugin } from './scripts/local-flow-review-vite-plugin';
import { replayFixturesVitePlugin } from './scripts/replay-fixtures-vite-plugin';

const LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA = 'gw.local-ranked-root-smoke-build.v1';

function localRankedRootSmokeBuildAttestationPlugin(): Plugin {
  const enabled = String(process.env.VITE_LOCAL_RANKED_ROOT_SMOKE ?? '').toLowerCase() === 'true';
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
        source: `${JSON.stringify({
          schemaVersion: LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA,
          enabled: true,
          buildId: String(process.env.VITE_APP_BUILD ?? '').trim(),
          apiBaseUrl: String(
            process.env.VITE_MATCHMAKING_API_BASE
              ?? process.env.VITE_PROFILE_API_BASE
              ?? '',
          ).trim().replace(/\/+$/, ''),
        }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  envDir: '../..',
  plugins: [
    localFlowReviewVitePlugin(),
    replayFixturesVitePlugin(),
    localRankedRootSmokeBuildAttestationPlugin(),
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
      input: {
        game: fileURLToPath(new URL('index.html', import.meta.url)),
        webRtcSmoke: fileURLToPath(new URL('webrtc-smoke.html', import.meta.url)),
        webRtcPeerSmoke: fileURLToPath(new URL('webrtc-peer-smoke.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          return id.includes('/node_modules/three/') ? 'three' : undefined;
        },
      },
    },
  },
});
