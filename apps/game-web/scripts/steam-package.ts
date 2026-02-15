import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

interface CliOptions {
  distDir: string;
  outputDir: string;
}

interface PackageManifest {
  formatVersion: number;
  platform: 'steam';
  generatedAt: string;
  contentRoot: string;
  entryPoint: string;
  build: {
    version: string;
    commitSha: string | null;
    runId: string | null;
  };
  signing: {
    algorithm: 'rsa-sha256';
    mode: 'provided-key' | 'ephemeral-ci';
    signatureFile: string;
    checksumsFile: string;
    publicKeyFile: string;
  };
}

const DEFAULT_DIST_DIR = 'dist';
const DEFAULT_OUTPUT_DIR = 'steam-artifact';
const CHECKSUMS_FILE = 'checksums.sha256';
const SIGNATURE_FILE = 'checksums.sha256.sig';
const PUBLIC_KEY_FILE = 'signing-public-key.pem';
const MANIFEST_FILE = 'manifest.json';
const APP_ID_FILE = 'steam_appid.txt';

function parseArgs(argv: string[]): CliOptions {
  let distDir = DEFAULT_DIST_DIR;
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dist') {
      distDir = argv[i + 1] ?? distDir;
      i += 1;
      continue;
    }
    if (arg === '--out-dir') {
      outputDir = argv[i + 1] ?? outputDir;
      i += 1;
    }
  }

  return { distDir, outputDir };
}

function collectFilesRecursively(rootDir: string): string[] {
  const output: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = readdirSync(currentDir).sort();
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        stack.push(fullPath);
      } else if (stats.isFile()) {
        output.push(fullPath);
      }
    }
  }

  return output.sort();
}

function hashFileSha256(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function decodePemFromEnv(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed;
  }
  return Buffer.from(trimmed, 'base64').toString('utf8');
}

function createSignature(payload: Buffer): {
  signatureBase64: string;
  publicKeyPem: string;
  mode: 'provided-key' | 'ephemeral-ci';
} {
  const privateKeyRaw = process.env.STEAM_ARTIFACT_SIGNING_KEY?.trim() ?? '';
  if (privateKeyRaw.length > 0) {
    const privateKeyPem = decodePemFromEnv(privateKeyRaw);
    const privateKey = createPrivateKey(privateKeyPem);
    const signatureBase64 = sign('sha256', payload, privateKey).toString('base64');
    const configuredPublicKeyRaw = process.env.STEAM_ARTIFACT_SIGNING_PUBLIC_KEY?.trim() ?? '';
    const publicKeyPem = configuredPublicKeyRaw.length > 0
      ? decodePemFromEnv(configuredPublicKeyRaw)
      : createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
    return {
      signatureBase64,
      publicKeyPem,
      mode: 'provided-key',
    };
  }

  const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    signatureBase64: sign('sha256', payload, keyPair.privateKey).toString('base64'),
    publicKeyPem: keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    mode: 'ephemeral-ci',
  };
}

function normalisePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = process.cwd();
  const resolvedDistDir = resolve(workspaceRoot, options.distDir);
  const resolvedOutputDir = resolve(workspaceRoot, options.outputDir);
  const contentDir = join(resolvedOutputDir, 'content');

  if (!existsSync(resolvedDistDir)) {
    throw new Error(`Steam package failed: dist directory not found at ${resolvedDistDir}`);
  }

  rmSync(resolvedOutputDir, { recursive: true, force: true });
  mkdirSync(contentDir, { recursive: true });
  cpSync(resolvedDistDir, contentDir, { recursive: true });

  const appId = (process.env.STEAM_APP_ID ?? '').trim();
  if (appId.length > 0) {
    writeFileSync(join(resolvedOutputDir, APP_ID_FILE), `${appId}\n`, 'utf8');
  }

  const packagedFiles = collectFilesRecursively(contentDir);
  const checksumLines = packagedFiles.map((filePath) => {
    const relativePath = normalisePath(relative(resolvedOutputDir, filePath));
    const digest = hashFileSha256(filePath);
    return `${digest}  ${relativePath}`;
  });
  const checksumsPayload = `${checksumLines.join('\n')}\n`;
  writeFileSync(join(resolvedOutputDir, CHECKSUMS_FILE), checksumsPayload, 'utf8');

  const signature = createSignature(Buffer.from(checksumsPayload, 'utf8'));
  writeFileSync(join(resolvedOutputDir, SIGNATURE_FILE), `${signature.signatureBase64}\n`, 'utf8');
  writeFileSync(join(resolvedOutputDir, PUBLIC_KEY_FILE), signature.publicKeyPem, 'utf8');

  const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as { version?: string };
  const manifest: PackageManifest = {
    formatVersion: 1,
    platform: 'steam',
    generatedAt: new Date().toISOString(),
    contentRoot: 'content',
    entryPoint: 'index.html',
    build: {
      version: packageJson.version ?? '0.0.0',
      commitSha: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
    },
    signing: {
      algorithm: 'rsa-sha256',
      mode: signature.mode,
      signatureFile: SIGNATURE_FILE,
      checksumsFile: CHECKSUMS_FILE,
      publicKeyFile: PUBLIC_KEY_FILE,
    },
  };

  writeFileSync(join(resolvedOutputDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Steam package created at ${normalisePath(relative(workspaceRoot, resolvedOutputDir))}`);
  console.log(`- Packaged files: ${packagedFiles.length}`);
  console.log(`- Signature mode: ${signature.mode}`);
}

main();
