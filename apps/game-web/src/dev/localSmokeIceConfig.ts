export interface LocalSmokeIceConfig {
  iceServers: readonly RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
}

export interface LocalSmokeRtcConfiguration extends RTCConfiguration {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
}

function asUrlList(urls: RTCIceServer['urls']): string[] {
  return typeof urls === 'string' ? [urls] : [...urls];
}

function isDirectDiscoveryUrl(url: string): boolean {
  return /^stuns?:/i.test(url.trim());
}

export function buildLocalSmokeRtcConfiguration(
  config: LocalSmokeIceConfig,
  forceRelay: boolean,
): LocalSmokeRtcConfiguration {
  if (forceRelay) {
    return {
      iceServers: config.iceServers.map((server) => ({
        ...server,
        urls: asUrlList(server.urls),
      })),
      iceTransportPolicy: 'relay',
    };
  }

  return {
    // A direct-path proof must not silently succeed through an available TURN candidate.
    iceServers: config.iceServers.flatMap((server) => {
      const urls = asUrlList(server.urls).filter(isDirectDiscoveryUrl);
      return urls.length > 0 ? [{ ...server, urls }] : [];
    }),
    iceTransportPolicy: 'all',
  };
}
