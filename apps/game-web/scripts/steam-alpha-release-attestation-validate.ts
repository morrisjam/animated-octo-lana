import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSteamAlphaReleaseBuildOutput } from '../src/build/steamAlphaReleaseAttestation';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const repositorySha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
const expectedReleaseSha = String(
  process.env.STEAM_RELEASE_COMMIT_SHA
    ?? process.env.GITHUB_SHA
    ?? repositorySha,
).trim();
const requireCleanRelease = ['1', 'true'].includes(
  String(process.env.STEAM_REQUIRE_CLEAN_RELEASE ?? '').trim().toLowerCase(),
);

const attestation = await validateSteamAlphaReleaseBuildOutput(
  path.join(appRoot, 'dist'),
  expectedReleaseSha,
  { requireCleanRelease },
);
console.log(`Steam alpha release attestation verified for ${attestation.releaseSha}.`);
