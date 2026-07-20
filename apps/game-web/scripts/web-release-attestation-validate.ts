import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveCloudflarePagesReleaseBuild,
  validateWebReleaseBuildOutput,
} from '../src/build/webReleaseAttestation';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, '..');
const releaseBuild = resolveCloudflarePagesReleaseBuild({
  cfPages: process.env.CF_PAGES,
  cfPagesCommitSha: process.env.CF_PAGES_COMMIT_SHA,
  configuredBuildId: process.env.VITE_APP_BUILD,
  localRankedRootSmoke: process.env.VITE_LOCAL_RANKED_ROOT_SMOKE,
});

if (!releaseBuild) {
  console.log('Web release attestation: skipped outside Cloudflare Pages mode.');
} else {
  const attestation = await validateWebReleaseBuildOutput(
    path.join(appRoot, 'dist'),
    releaseBuild.releaseSha,
  );
  console.log(`Web release attestation verified for ${attestation.releaseSha}.`);
}
