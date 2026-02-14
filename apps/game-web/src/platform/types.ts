export type PlatformKind = 'web' | 'steam';

export interface PlatformAuthSession {
  accountId: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
}

export interface WebAuthSignupRequest {
  email: string;
  password: string;
  displayName?: string | null;
  upgradeCurrentGuest?: boolean;
}

export interface WebAuthSigninRequest {
  email: string;
  password: string;
}

export interface PlatformAuthService {
  getSession(): Promise<PlatformAuthSession>;
  signUp?(request: WebAuthSignupRequest): Promise<PlatformAuthSession>;
  signIn?(request: WebAuthSigninRequest): Promise<PlatformAuthSession>;
  signOut?(): Promise<PlatformAuthSession>;
}

export interface PlatformStorageService {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PlatformPresenceService {
  setStatus(status: string): Promise<void>;
  getStatus(): string | null;
}

export interface PlayerProfile {
  accountId: string;
  displayName: string | null;
  settings: Record<string, unknown>;
  updatedAt: string | null;
  source: 'remote' | 'cache' | 'default';
}

export interface PlatformProfileService {
  getProfile(accountId: string): Promise<PlayerProfile>;
  saveProfile(
    accountId: string,
    payload: { displayName?: string | null; settings?: Record<string, unknown> },
  ): Promise<PlayerProfile>;
}

export interface PlatformServices {
  kind: PlatformKind;
  auth: PlatformAuthService;
  storage: PlatformStorageService;
  presence: PlatformPresenceService;
  profile: PlatformProfileService;
  dispose?(): void;
}
