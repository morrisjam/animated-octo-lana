import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import process from 'node:process';

interface CliOptions {
  packagedDir: string;
}

const DEFAULT_PACKAGED_DIR = 'steam-artifact';

function parseArgs(argv: string[]): CliOptions {
  let packagedDir = DEFAULT_PACKAGED_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--packaged-dir') {
      packagedDir = argv[i + 1] ?? packagedDir;
      i += 1;
    }
  }
  return { packagedDir };
}

function parseAssetReferences(indexHtml: string): string[] {
  const references = new Set<string>();
  const scriptRegex = /<script[^>]+src="([^"]+)"/g;
  const stylesheetRegex = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;

  let scriptMatch = scriptRegex.exec(indexHtml);
  while (scriptMatch) {
    references.add(scriptMatch[1]);
    scriptMatch = scriptRegex.exec(indexHtml);
  }

  let stylesheetMatch = stylesheetRegex.exec(indexHtml);
  while (stylesheetMatch) {
    references.add(stylesheetMatch[1]);
    stylesheetMatch = stylesheetRegex.exec(indexHtml);
  }

  return [...references];
}

function assertNoRemoteAssetDependencies(assetReferences: string[]): void {
  const remoteAssets = assetReferences.filter((value) => (
    value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('//')
  ));
  if (remoteAssets.length > 0) {
    throw new Error(`Steam smoke check failed: remote asset dependencies found (${remoteAssets.join(', ')}).`);
  }
}

function createStaticServer(rootDir: string) {
  return createServer((request, response) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.statusCode = 405;
      response.end('method not allowed');
      return;
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const fullPath = resolve(rootDir, `.${safePath}`);

    if (!fullPath.startsWith(rootDir) || !existsSync(fullPath) || statSync(fullPath).isDirectory()) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    const extension = extname(fullPath);
    if (extension === '.html') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
    } else if (extension === '.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8');
    } else if (extension === '.css') {
      response.setHeader('content-type', 'text/css; charset=utf-8');
    }

    if (method === 'HEAD') {
      response.statusCode = 200;
      response.end();
      return;
    }

    createReadStream(fullPath).pipe(response);
  });
}

async function fetchOrThrow(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Steam smoke check failed: request ${url} returned ${response.status}.`);
  }
  return response.text();
}

function findPackagedContentDirectory(packagedDir: string): string {
  const resolvedPackageDir = resolve(process.cwd(), packagedDir);
  const contentDir = join(resolvedPackageDir, 'content');
  if (!existsSync(contentDir)) {
    throw new Error(`Steam smoke check failed: packaged content directory not found at ${contentDir}`);
  }
  const indexPath = join(contentDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Steam smoke check failed: index.html not found at ${indexPath}`);
  }
  return contentDir;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const contentDir = findPackagedContentDirectory(options.packagedDir);
  const indexPath = join(contentDir, 'index.html');
  const staticIndexHtml = readFileSync(indexPath, 'utf8');
  const assetReferences = parseAssetReferences(staticIndexHtml);

  if (assetReferences.length === 0) {
    throw new Error('Steam smoke check failed: no script or stylesheet assets found in index.html.');
  }
  assertNoRemoteAssetDependencies(assetReferences);

  const server = createStaticServer(contentDir);
  await new Promise<void>((resolveStart) => {
    server.listen(0, '127.0.0.1', resolveStart);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Steam smoke check failed: unable to read local server address.');
    }

    const port = (address as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const launchedIndexHtml = await fetchOrThrow(`${baseUrl}/`);
    if (!launchedIndexHtml.includes('<!doctype html') && !launchedIndexHtml.includes('<!DOCTYPE html')) {
      throw new Error('Steam smoke check failed: index payload did not look like HTML.');
    }

    for (const assetReference of assetReferences) {
      const resolvedUrl = new URL(assetReference, `${baseUrl}/`).toString();
      await fetchOrThrow(resolvedUrl);
    }
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
  }

  console.log('Steam smoke check passed: packaged build launched locally and static assets resolved.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
