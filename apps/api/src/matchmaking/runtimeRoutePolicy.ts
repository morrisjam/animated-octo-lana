const SESSION_SIGNAL_ROUTE = /^\/matchmaking\/sessions\/[^/]+\/signals\/?$/;
const REPLAY_INGEST_ROUTE = /^\/replays\/ingest\/?$/;

export function requestUsesMatchmakingRuntime(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (SESSION_SIGNAL_ROUTE.test(path)) {
    return false;
  }
  return REPLAY_INGEST_ROUTE.test(path)
    || path.startsWith('/matchmaking/')
    || path.startsWith('/ranked/results')
    || path.startsWith('/ops/matchmaking/');
}
