import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPublicRelease, parsePublicReleaseCheckArgs } from '../src/ops/publicReleaseCheck';

const report = await checkPublicRelease(parsePublicReleaseCheckArgs(process.argv.slice(2)));
const directory = resolve('build-artifacts/public-release-check');
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
