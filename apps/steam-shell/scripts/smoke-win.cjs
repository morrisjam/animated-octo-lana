'use strict';

const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const shellRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(shellRoot, 'release');
const packageDir = readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('GravityWell-win32-x64'))
  .map((entry) => path.join(releaseRoot, entry.name))[0];

if (!packageDir) {
  throw new Error('Steam shell smoke failed: Windows package directory was not found.');
}

const requiredPaths = [
  'GravityWell.exe',
  'steam_api64.dll',
  'resources/app/main.cjs',
  'resources/app/preload.cjs',
  'resources/app/authTransport.cjs',
  'resources/app/ticketBroker.cjs',
  'resources/app/web/index.html',
  'resources/app/node_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node',
];
for (const relativePath of requiredPaths) {
  if (!existsSync(path.join(packageDir, relativePath))) {
    throw new Error(`Steam shell smoke failed: missing ${relativePath}.`);
  }
}

const runtimeNodeModules = path.join(packageDir, 'resources/app/node_modules');
const runtimeDependencies = readdirSync(runtimeNodeModules).sort();
if (runtimeDependencies.length !== 1 || runtimeDependencies[0] !== 'steamworks.js') {
  throw new Error(`Steam shell smoke failed: unexpected runtime dependencies: ${runtimeDependencies.join(', ')}`);
}
const steamworksPlatforms = readdirSync(path.join(runtimeNodeModules, 'steamworks.js/dist')).sort();
if (steamworksPlatforms.length !== 1 || steamworksPlatforms[0] !== 'win64') {
  throw new Error(`Steam shell smoke failed: unexpected Steamworks platforms: ${steamworksPlatforms.join(', ')}`);
}

if (existsSync(path.join(packageDir, 'steam_appid.txt')) && process.env.STEAM_INCLUDE_APP_ID_FILE !== 'true') {
  throw new Error('Steam shell smoke failed: production artifact contains steam_appid.txt.');
}
const indexHtml = readFileSync(path.join(packageDir, 'resources/app/web/index.html'), 'utf8');
if (/<(?:script|link)[^>]+(?:src|href)=["'](?:https?:)?\/\//i.test(indexHtml)) {
  throw new Error('Steam shell smoke failed: packaged entry point references remote executable assets.');
}
const packagedAppRoot = path.join(packageDir, 'resources/app');
const packagedConfig = JSON.parse(readFileSync(path.join(packagedAppRoot, 'package.json'), 'utf8'));
const { resolveSteamAuthEndpoint } = require(path.join(packagedAppRoot, 'authTransport.cjs'));
const configuredEndpoint = resolveSteamAuthEndpoint(packagedConfig.gravityWell?.steamAuthApiBase);
if (configuredEndpoint !== 'https://api.gravitywell.space/auth/steam/exchange') {
  throw new Error(`Steam shell smoke failed: unexpected packaged auth endpoint ${configuredEndpoint}.`);
}
const preloadSource = readFileSync(path.join(packagedAppRoot, 'preload.cjs'), 'utf8');
if (!preloadSource.includes('gravity-well:steam:exchange-session')) {
  throw new Error('Steam shell smoke failed: main-process auth exchange bridge is missing.');
}

console.log(`Steam shell artifact smoke passed: ${packageDir}`);
