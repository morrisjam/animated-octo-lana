export type ApiTrustProxy = number | false;

export function resolveTrustProxyHops(value: string | undefined): ApiTrustProxy {
  if (!value?.trim()) {
    return false;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error('API_TRUST_PROXY_HOPS must be an integer between 1 and 8.');
  }
  return parsed;
}
