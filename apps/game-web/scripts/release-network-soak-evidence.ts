import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createReleaseNetworkSoakEvidence,
  sha256Hex,
} from '../src/dev/releaseNetworkSoakEvidence';

function requiredEnvironment(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function readJsonWithDigest(filePath: string): Promise<{ value: unknown; digest: string }> {
  const source = await readFile(path.resolve(filePath), 'utf8');
  return {
    value: JSON.parse(source),
    digest: sha256Hex(source),
  };
}

const [webAttestation, directReport, relayReport] = await Promise.all([
  readJsonWithDigest(requiredEnvironment('RELEASE_NETWORK_SOAK_WEB_ATTESTATION_PATH')),
  readJsonWithDigest(requiredEnvironment('RELEASE_NETWORK_SOAK_DIRECT_REPORT_PATH')),
  readJsonWithDigest(requiredEnvironment('RELEASE_NETWORK_SOAK_RELAY_REPORT_PATH')),
]);
const evidence = createReleaseNetworkSoakEvidence({
  expectedReleaseSha: requiredEnvironment('RELEASE_NETWORK_SOAK_EXPECT_SHA'),
  workflowRunId: requiredEnvironment('GITHUB_RUN_ID'),
  webAttestation: webAttestation.value,
  directReport: directReport.value,
  directReportSha256: directReport.digest,
  relayReport: relayReport.value,
  relayReportSha256: relayReport.digest,
});
const outputPath = path.resolve(requiredEnvironment('RELEASE_NETWORK_SOAK_EVIDENCE_PATH'));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`Release network soak evidence written to ${outputPath}.`);
