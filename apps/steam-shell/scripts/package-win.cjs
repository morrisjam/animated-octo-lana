'use strict';

const { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const packagerModule = require('@electron/packager');

const packager = packagerModule.packager ?? packagerModule.default ?? packagerModule;
const shellRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(shellRoot, 'release');

async function main() {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const appPaths = await packager({
    dir: shellRoot,
    out: outputRoot,
    name: 'GravityWell',
    executableName: 'GravityWell',
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    prune: true,
    asar: false,
    win32metadata: {
      CompanyName: 'Gravity Well',
      FileDescription: 'Gravity Well',
      InternalName: 'GravityWell',
      OriginalFilename: 'GravityWell.exe',
      ProductName: 'Gravity Well',
    },
    ignore: [
      /^\/release(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/test(?:\/|$)/,
      /^\/package-lock\.json$/,
      /^\/README\.md$/,
    ],
  });

  const steamDll = path.join(
    shellRoot,
    'node_modules',
    'steamworks.js',
    'dist',
    'win64',
    'steam_api64.dll',
  );
  if (!existsSync(steamDll)) {
    throw new Error('steamworks.js Windows redistributable is missing.');
  }
  for (const appPath of appPaths) {
    copyFileSync(steamDll, path.join(appPath, 'steam_api64.dll'));
    const runtimeNodeModules = path.join(appPath, 'resources', 'app', 'node_modules');
    for (const entry of readdirSync(runtimeNodeModules)) {
      if (entry !== 'steamworks.js') {
        rmSync(path.join(runtimeNodeModules, entry), { recursive: true, force: true });
      }
    }
    const packagedSteamworksDist = path.join(runtimeNodeModules, 'steamworks.js', 'dist');
    rmSync(path.join(packagedSteamworksDist, 'linux64'), { recursive: true, force: true });
    rmSync(path.join(packagedSteamworksDist, 'osx'), { recursive: true, force: true });
    if (process.env.STEAM_INCLUDE_APP_ID_FILE === 'true') {
      const appId = String(process.env.STEAM_APP_ID ?? '').trim();
      if (!/^\d+$/.test(appId) || Number(appId) <= 0) {
        throw new Error('STEAM_APP_ID must be a positive integer when including a local app-id file.');
      }
      writeFileSync(path.join(appPath, 'steam_appid.txt'), `${appId}\n`, 'utf8');
    }
    console.log(`Packaged Gravity Well Steam shell at ${appPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
