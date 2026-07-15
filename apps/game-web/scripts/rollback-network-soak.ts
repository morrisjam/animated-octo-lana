import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_LOCAL_ALPHA_PROFILE,
  runRollbackNetworkSoak,
  type NetworkImpairmentProfile,
} from '../src/net/rollbackNetworkSoak';

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function readNumberOption(name: string, fallback: number): number {
  const raw = readOption(name);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be numeric. Received: ${raw}`);
  }
  return value;
}

const profile: Partial<NetworkImpairmentProfile> = {
  id: readOption('--profile-id') ?? DEFAULT_LOCAL_ALPHA_PROFILE.id,
  frames: readNumberOption('--frames', DEFAULT_LOCAL_ALPHA_PROFILE.frames),
  seed: readNumberOption('--seed', DEFAULT_LOCAL_ALPHA_PROFILE.seed),
  baseLatencyFrames: readNumberOption('--latency-frames', DEFAULT_LOCAL_ALPHA_PROFILE.baseLatencyFrames),
  jitterFrames: readNumberOption('--jitter-frames', DEFAULT_LOCAL_ALPHA_PROFILE.jitterFrames),
  packetLossRate: readNumberOption('--loss-rate', DEFAULT_LOCAL_ALPHA_PROFILE.packetLossRate),
  reorderRate: readNumberOption('--reorder-rate', DEFAULT_LOCAL_ALPHA_PROFILE.reorderRate),
  duplicateRate: readNumberOption('--duplicate-rate', DEFAULT_LOCAL_ALPHA_PROFILE.duplicateRate),
};

const report = runRollbackNetworkSoak({ profile });
const outputPath = path.resolve(
  process.cwd(),
  readOption('--output') ?? 'build-artifacts/rollback-network-soak-report.json',
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Rollback network soak: ${report.passed ? 'PASS' : 'FAIL'}`);
console.log(`Profile: ${report.profile.id} | ${report.profile.frames} frames | seed ${report.profile.seed}`);
console.log(
  `Convergence: ${report.canonicalConvergence} | checksum ${report.canonicalChecksum} | drain ${report.drainFramesUsed} frames`,
);
console.log(
  `P1 rollback p95/max: ${report.clients.P1.rollbackDepthFrames.p95}/${report.clients.P1.rollbackDepthFrames.max}`,
);
console.log(
  `P2 rollback p95/max: ${report.clients.P2.rollbackDepthFrames.p95}/${report.clients.P2.rollbackDepthFrames.max}`,
);
console.log(
  `Dropped packets: ${report.links.P1_to_P2.droppedPackets + report.links.P2_to_P1.droppedPackets}`,
);
console.log(`Report: ${outputPath}`);

if (!report.passed) {
  for (const failure of report.failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}
