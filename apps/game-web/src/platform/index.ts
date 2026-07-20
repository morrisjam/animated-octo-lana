import { createSteamPlatformServices } from './steam';
import type { PlatformServices } from './types';
import { createWebPlatformServices } from './web';

export * from './types';
export * from './lifecycle';
export * from './persistence';
export * from './persistenceKeys';

export function createPlatformServices(): PlatformServices {
  const configuredPlatform = String(import.meta.env.VITE_PLATFORM ?? 'web').toLowerCase();
  if (configuredPlatform === 'steam') {
    return createSteamPlatformServices();
  }
  return createWebPlatformServices();
}
