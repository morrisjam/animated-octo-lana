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
  'resources/app/web/steam-alpha-release.json',
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
const steamRelease = JSON.parse(readFileSync(
  path.join(packagedAppRoot, 'web', 'steam-alpha-release.json'),
  'utf8',
));
const expectedReleaseSha = String(process.env.GITHUB_SHA ?? '').trim().toLowerCase();
if (
  steamRelease.schemaVersion !== 'gw.steam-alpha-release.v1'
  || steamRelease.profile !== 'controlled-online-alpha'
  || steamRelease.platform !== 'steam'
  || !/^[0-9a-f]{40}$/i.test(String(steamRelease.releaseSha ?? ''))
  || (expectedReleaseSha && String(steamRelease.releaseSha).toLowerCase() !== expectedReleaseSha)
  || steamRelease.entitlementMode !== 'require_auth'
  || steamRelease.features?.online !== true
  || steamRelease.features?.ranked !== true
  || steamRelease.features?.onlineMatchRuntime !== true
  || steamRelease.features?.debugTools !== false
  || steamRelease.features?.onlineDiagnostics !== false
  || steamRelease.features?.onlineDevMenu !== false
) {
  throw new Error('Steam shell smoke failed: packaged web client is not the exact controlled online-alpha profile.');
}
if (
  process.env.STEAM_REQUIRE_CLEAN_RELEASE === 'true'
  && steamRelease.sourceDirty !== false
) {
  throw new Error('Steam shell smoke failed: release package was built from a dirty source tree.');
}
if (existsSync(path.join(packagedAppRoot, 'web', 'local-ranked-root-smoke-build.json'))) {
  throw new Error('Steam shell smoke failed: package contains local ranked-root instrumentation.');
}
const packagedAssets = path.join(packagedAppRoot, 'web', 'assets');
const releaseShaInBundle = readdirSync(packagedAssets)
  .filter((entry) => entry.endsWith('.js'))
  .some((entry) => readFileSync(path.join(packagedAssets, entry), 'utf8')
    .toLowerCase()
    .includes(String(steamRelease.releaseSha).toLowerCase()));
if (!releaseShaInBundle) {
  throw new Error('Steam shell smoke failed: packaged JavaScript does not contain its release SHA.');
}
const { resolveSteamAuthEndpoint } = require(path.join(packagedAppRoot, 'authTransport.cjs'));
const configuredEndpoint = resolveSteamAuthEndpoint(packagedConfig.gravityWell?.steamAuthApiBase);
if (configuredEndpoint !== 'https://api.gravitywell.space/auth/steam/exchange') {
  throw new Error(`Steam shell smoke failed: unexpected packaged auth endpoint ${configuredEndpoint}.`);
}
if (`${steamRelease.apiBaseUrl}/auth/steam/exchange` !== configuredEndpoint) {
  throw new Error('Steam shell smoke failed: packaged web and native API endpoints disagree.');
}
if (steamRelease.profile !== packagedConfig.gravityWell?.releaseProfile) {
  throw new Error('Steam shell smoke failed: packaged web and native release profiles disagree.');
}
if (steamRelease.steamWebApiIdentity !== packagedConfig.gravityWell?.steamWebApiIdentity) {
  throw new Error('Steam shell smoke failed: packaged web and native Steam identities disagree.');
}
if (steamRelease.rulesetVersion !== packagedConfig.gravityWell?.rulesetVersion) {
  throw new Error('Steam shell smoke failed: packaged web and native ruleset versions disagree.');
}
if (steamRelease.balanceProfileId !== packagedConfig.gravityWell?.balanceProfileId) {
  throw new Error('Steam shell smoke failed: packaged web and native balance profiles disagree.');
}
const preloadSource = readFileSync(path.join(packagedAppRoot, 'preload.cjs'), 'utf8');
if (!preloadSource.includes('gravity-well:steam:exchange-session')) {
  throw new Error('Steam shell smoke failed: main-process auth exchange bridge is missing.');
}

console.log(`Steam shell artifact smoke passed: ${packageDir}`);
