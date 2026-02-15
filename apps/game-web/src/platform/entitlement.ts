import type { PlatformEntitlementAccess, PlatformEntitlementService } from './types';

export type EntitlementMode = 'open' | 'require_auth' | 'force_denied' | 'unavailable';

export interface EntitlementServiceConfig {
  mode: EntitlementMode;
  platformLabel: string;
  deniedMessage?: string;
  unavailableMessage?: string;
}

export function parseEntitlementMode(raw: string | undefined, fallback: EntitlementMode): EntitlementMode {
  const mode = String(raw ?? '').trim().toLowerCase();
  if (mode === 'open' || mode === 'require_auth' || mode === 'force_denied' || mode === 'unavailable') {
    return mode;
  }
  return fallback;
}

function buildAccess(
  status: PlatformEntitlementAccess['status'],
  code: string,
  message: string,
): PlatformEntitlementAccess {
  return {
    allowed: status === 'granted',
    status,
    code,
    message,
  };
}

export function createConfiguredEntitlementService(config: EntitlementServiceConfig): PlatformEntitlementService {
  return {
    async checkAccess(context?: { stage?: 'startup' | 'session'; accountId?: string | null }): Promise<PlatformEntitlementAccess> {
      const stage = context?.stage ?? 'startup';
      const accountId = context?.accountId ?? null;

      if (config.mode === 'open') {
        return buildAccess(
          'granted',
          `${config.platformLabel}_open_access`,
          'Access granted.',
        );
      }

      if (config.mode === 'require_auth') {
        if (accountId) {
          return buildAccess(
            'granted',
            `${config.platformLabel}_account_verified`,
            'Access granted for authenticated account.',
          );
        }
        return buildAccess(
          'denied',
          `${config.platformLabel}_account_required`,
          stage === 'startup'
            ? 'Sign in to continue to gameplay.'
            : 'This action requires a signed-in account.',
        );
      }

      if (config.mode === 'force_denied') {
        return buildAccess(
          'denied',
          `${config.platformLabel}_forced_denied`,
          config.deniedMessage ?? 'Entitlement check denied access.',
        );
      }

      return buildAccess(
        'unavailable',
        `${config.platformLabel}_provider_unavailable`,
        config.unavailableMessage ?? 'Entitlement provider is unavailable for this runtime.',
      );
    },
  };
}
