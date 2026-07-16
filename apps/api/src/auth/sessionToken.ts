import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type AuthSessionProvider = 'guest' | 'web' | 'steam';

export interface AuthSessionTokenPayload {
  accountId: string;
  provider: AuthSessionProvider;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
}

export interface IssuedAuthSessionToken {
  accessToken: string;
  accessTokenExpiresAt: string;
  tokenType: 'Bearer';
}

export type AuthSessionTokenValidationResult =
  | { ok: true; payload: AuthSessionTokenPayload }
  | { ok: false; code: 'missing' | 'malformed' | 'invalid_signature' | 'invalid_payload' | 'expired' };

export interface AuthSessionTokenServiceOptions {
  secret: string;
  previousSecrets?: readonly string[];
  ttlSeconds?: number;
  now?: () => number;
}

interface SerializedAuthSessionToken {
  v: 1;
  sub: string;
  prv: AuthSessionProvider;
  iat: number;
  exp: number;
  jti: string;
}

const TOKEN_PREFIX = 'gw1';
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set<AuthSessionProvider>(['guest', 'web', 'steam']);

function signTokenBody(secret: string, tokenBody: string): Buffer {
  return createHmac('sha256', secret).update(tokenBody).digest();
}

function parseSerializedPayload(rawPayload: string): SerializedAuthSessionToken | null {
  try {
    const parsed = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8')) as Partial<SerializedAuthSessionToken>;
    if (
      parsed.v !== 1
      || typeof parsed.sub !== 'string'
      || !UUID_REGEX.test(parsed.sub)
      || typeof parsed.prv !== 'string'
      || !PROVIDERS.has(parsed.prv as AuthSessionProvider)
      || !Number.isInteger(parsed.iat)
      || !Number.isInteger(parsed.exp)
      || typeof parsed.jti !== 'string'
      || parsed.jti.length < 8
    ) {
      return null;
    }
    return parsed as SerializedAuthSessionToken;
  } catch {
    return null;
  }
}

export class AuthSessionTokenService {
  private readonly signingSecret: string;

  private readonly verificationSecrets: readonly string[];

  private readonly ttlSeconds: number;

  private readonly now: () => number;

  public constructor(options: AuthSessionTokenServiceOptions) {
    const signingSecret = options.secret.trim();
    if (signingSecret.length < 32) {
      throw new Error('Auth session token secret must contain at least 32 characters.');
    }
    const previousSecrets = (options.previousSecrets ?? []).map((secret) => secret.trim());
    if (previousSecrets.length > 2) {
      throw new Error('Auth session token verification supports at most two previous secrets.');
    }
    for (const previousSecret of previousSecrets) {
      if (previousSecret.trim().length < 32) {
        throw new Error('Every previous auth session token secret must contain at least 32 characters.');
      }
    }
    const verificationSecrets = [signingSecret, ...previousSecrets];
    if (new Set(verificationSecrets).size !== verificationSecrets.length) {
      throw new Error('Auth session token secrets must be distinct.');
    }
    this.signingSecret = signingSecret;
    this.verificationSecrets = verificationSecrets;
    this.ttlSeconds = Math.max(60, Math.floor(options.ttlSeconds ?? DEFAULT_TTL_SECONDS));
    this.now = options.now ?? Date.now;
  }

  public issue(accountId: string, provider: AuthSessionProvider): IssuedAuthSessionToken {
    if (!UUID_REGEX.test(accountId)) {
      throw new Error('Cannot issue an auth session token for an invalid account id.');
    }
    const issuedAt = Math.floor(this.now() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;
    const payload: SerializedAuthSessionToken = {
      v: 1,
      sub: accountId,
      prv: provider,
      iat: issuedAt,
      exp: expiresAt,
      jti: randomUUID(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const tokenBody = `${TOKEN_PREFIX}.${encodedPayload}`;
    const signature = signTokenBody(this.signingSecret, tokenBody).toString('base64url');
    return {
      accessToken: `${tokenBody}.${signature}`,
      accessTokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
      tokenType: 'Bearer',
    };
  }

  public verify(rawToken: unknown): AuthSessionTokenValidationResult {
    if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      return { ok: false, code: 'missing' };
    }
    const parts = rawToken.trim().split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
      return { ok: false, code: 'malformed' };
    }

    const tokenBody = `${parts[0]}.${parts[1]}`;
    let providedSignature: Buffer;
    try {
      providedSignature = Buffer.from(parts[2], 'base64url');
    } catch {
      return { ok: false, code: 'malformed' };
    }
    let validSignature = false;
    for (const secret of this.verificationSecrets) {
      const expectedSignature = signTokenBody(secret, tokenBody);
      if (
        providedSignature.length === expectedSignature.length
        && timingSafeEqual(providedSignature, expectedSignature)
      ) {
        validSignature = true;
      }
    }
    if (!validSignature) {
      return { ok: false, code: 'invalid_signature' };
    }

    const serialized = parseSerializedPayload(parts[1]);
    if (!serialized || serialized.exp <= serialized.iat) {
      return { ok: false, code: 'invalid_payload' };
    }
    const nowSeconds = Math.floor(this.now() / 1000);
    if (serialized.iat > nowSeconds + 60) {
      return { ok: false, code: 'invalid_payload' };
    }
    if (nowSeconds >= serialized.exp) {
      return { ok: false, code: 'expired' };
    }

    return {
      ok: true,
      payload: {
        accountId: serialized.sub,
        provider: serialized.prv,
        issuedAt: serialized.iat,
        expiresAt: serialized.exp,
        tokenId: serialized.jti,
      },
    };
  }
}

export function createAuthSessionTokenService(options: AuthSessionTokenServiceOptions): AuthSessionTokenService {
  return new AuthSessionTokenService(options);
}
