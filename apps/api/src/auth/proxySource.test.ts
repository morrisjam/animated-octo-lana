import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { resolveTrustProxyHops, type ApiTrustProxy } from './proxySource';

async function resolveRequestSource({
  trustProxy,
  remoteAddress,
  forwardedFor,
}: {
  trustProxy: ApiTrustProxy;
  remoteAddress: string;
  forwardedFor?: string;
}): Promise<{ ip: string; ips?: string[] }> {
  const app = Fastify({ trustProxy });
  app.get('/source', async (request) => ({ ip: request.ip, ips: request.ips }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/source',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : undefined,
    });
    assert.equal(response.statusCode, 200);
    return response.json() as { ip: string; ips?: string[] };
  } finally {
    await app.close();
  }
}

test('rejects ambiguous or unsafe proxy hop configuration', () => {
  assert.equal(resolveTrustProxyHops(undefined), false);
  assert.equal(resolveTrustProxyHops('  '), false);
  assert.equal(resolveTrustProxyHops('1'), 1);
  assert.equal(resolveTrustProxyHops('8'), 8);
  for (const value of ['0', '1.5', '9', 'all', '-1']) {
    assert.throws(() => resolveTrustProxyHops(value), /integer between 1 and 8/, value);
  }
});

test('ignores forwarding headers when no proxy boundary is configured', async () => {
  const source = await resolveRequestSource({
    trustProxy: false,
    remoteAddress: '10.0.0.5',
    forwardedFor: '203.0.113.90, 198.51.100.44',
  });

  assert.equal(source.ip, '10.0.0.5');
  assert.equal(source.ips, undefined);
});

test('one trusted hop selects the nearest forwarded client and ignores spoofed prefixes', async () => {
  const first = await resolveRequestSource({
    trustProxy: 1,
    remoteAddress: '10.0.0.5',
    forwardedFor: '203.0.113.90, 198.51.100.44',
  });
  const second = await resolveRequestSource({
    trustProxy: 1,
    remoteAddress: '10.0.0.5',
    forwardedFor: '192.0.2.222, 198.51.100.44',
  });

  assert.equal(first.ip, '198.51.100.44');
  assert.equal(second.ip, first.ip);
  assert.deepEqual(first.ips, ['10.0.0.5', '198.51.100.44']);
});

test('two trusted hops select the client behind the internal proxy pair', async () => {
  const source = await resolveRequestSource({
    trustProxy: 2,
    remoteAddress: '10.0.0.6',
    forwardedFor: '203.0.113.90, 198.51.100.44, 10.0.0.5',
  });

  assert.equal(source.ip, '198.51.100.44');
  assert.deepEqual(source.ips, ['10.0.0.6', '10.0.0.5', '198.51.100.44']);
});
