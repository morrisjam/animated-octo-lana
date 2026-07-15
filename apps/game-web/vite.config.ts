import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { localFlowReviewVitePlugin } from './scripts/local-flow-review-vite-plugin';
import { replayFixturesVitePlugin } from './scripts/replay-fixtures-vite-plugin';

export default defineConfig({
  envDir: '../..',
  plugins: [localFlowReviewVitePlugin(), replayFixturesVitePlugin()],
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
