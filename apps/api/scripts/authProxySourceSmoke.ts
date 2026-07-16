import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { resolveTrustProxyHops, type ApiTrustProxy } from '../src/auth/proxySource';

interface SourceProbe {
  ip: string;
  ips?: string[];
}

async function probeSource({
  trustProxy,
  remoteAddress,
  forwardedFor,
}: {
  trustProxy: ApiTrustProxy;
  remoteAddress: string;
  forwardedFor: string;
}): Promise<SourceProbe> {
  const app = Fastify({ trustProxy, logger: false });
  app.get('/source', async (request) => ({ ip: request.ip, ips: request.ips }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/source',
      remoteAddress,
      headers: { 'x-forwarded-for': forwardedFor },
    });
    assert.equal(response.statusCode, 200);
    return response.json() as SourceProbe;
  } finally {
    await app.close();
  }
}

const direct = await probeSource({
  trustProxy: resolveTrustProxyHops(undefined),
  remoteAddress: '10.0.0.5',
  forwardedFor: '203.0.113.90, 198.51.100.44',
});
assert.equal(direct.ip, '10.0.0.5');
assert.equal(direct.ips, undefined);

const oneHopA = await probeSource({
  trustProxy: resolveTrustProxyHops('1'),
  remoteAddress: '10.0.0.5',
  forwardedFor: '203.0.113.90, 198.51.100.44',
});
const oneHopB = await probeSource({
  trustProxy: resolveTrustProxyHops('1'),
  remoteAddress: '10.0.0.5',
  forwardedFor: '192.0.2.222, 198.51.100.44',
});
const distinctClient = await probeSource({
  trustProxy: resolveTrustProxyHops('1'),
  remoteAddress: '10.0.0.5',
  forwardedFor: '203.0.113.90, 198.51.100.45',
});
assert.equal(oneHopA.ip, '198.51.100.44');
assert.equal(oneHopB.ip, oneHopA.ip);
assert.notEqual(distinctClient.ip, oneHopA.ip);
assert.deepEqual(oneHopA.ips, ['10.0.0.5', '198.51.100.44']);

const twoHop = await probeSource({
  trustProxy: resolveTrustProxyHops('2'),
  remoteAddress: '10.0.0.6',
  forwardedFor: '203.0.113.90, 198.51.100.44, 10.0.0.5',
});
assert.equal(twoHop.ip, '198.51.100.44');
assert.deepEqual(twoHop.ips, ['10.0.0.6', '10.0.0.5', '198.51.100.44']);

console.log(JSON.stringify({
  schemaVersion: 'gw.auth-proxy-source-smoke.v1',
  ok: true,
  localOnly: true,
  hostedServicesContacted: false,
  sourceField: 'request.ip',
  direct: {
    forwardedHeaderIgnored: true,
    source: direct.ip,
  },
  oneHop: {
    nearestForwardedClientSelected: true,
    spoofedPrefixIgnored: true,
    distinctClientsRemainDistinct: true,
    resolvedChain: oneHopA.ips,
  },
  twoHop: {
    clientBehindProxyPairSelected: true,
    resolvedChain: twoHop.ips,
  },
}, null, 2));
