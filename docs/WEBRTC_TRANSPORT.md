# WebRTC Online Transport

Gravity Well separates the online control plane from the gameplay data plane:

- Matchmaking, signed session tokens, reconnect state, WebRTC signaling, ranked settlement, and leaderboards use the API and PostgreSQL.
- Per-frame player inputs use a reliable ordered `RTCDataChannel`; they are not written to PostgreSQL or Neon.
- TURN carries the same DataChannel traffic when a direct peer route cannot traverse NAT. The selected direct/relay path is recorded through connection telemetry.

The PostgreSQL signaling mailbox stores only short-lived offer, answer, and ICE messages. Every row is partitioned by a durable server-issued transport attempt. Either authenticated participant may atomically request the next generation; concurrent requests carrying the same expected generation converge on one idempotent attempt, and stale publish or poll requests fail with `stale_transport_attempt`. Writes remain idempotent by session, sender, and client message id; reads are addressed to the authenticated peer and use a monotonic `BIGINT` cursor. Rows expire after ten minutes by default and are cleared shortly after a session resolves.

## Frame protocol

`WebRtcFrameTransport` wraps the DataChannel behind the existing `OnlineFrameTransport` contract:

- versioned, account-addressed JSON messages
- bounded frame batches
- application-level batch acknowledgement before the input pump retires an upload
- retry-safe receiver deduplication
- conflict detection for reused batch or frame ids
- per-epoch contiguous polling and two-way decisive-frame confirmation
- fail-closed handling for malformed, misrouted, oversized, unordered, or unreliable channels
- one bounded channel-replacement window that preserves transport history and freezes simulation while peers re-signal
- deterministic recovery agreement over attempt id, epoch, frame, score, phase, confirmation cursors, and state checksum before either peer resumes

Rollback remains deterministic above this transport. The local impairment soak still tests loss, jitter, duplication, reordering, retry, and checksum convergence independently of browser networking.

## Local browser smoke

This test uses local Docker Postgres and browser peer connections. It does not use Neon.

The full local proofs are:

```bash
npm run alpha:local-integration
npm run alpha:local-turn-integration
```

The first command covers the normal ICE path. The TURN variant additionally starts ephemeral local coturn, gives the API a random REST shared secret, requests short-lived account-scoped credentials, forces `iceTransportPolicy: relay`, and rejects any initial, recovered, or isolated two-client connection that does not report a relay candidate pair. Both commands validate a loopback database target, start or reuse local Docker PostgreSQL, build and serve the production client, run ranked/forfeit/restart/multi-instance checks plus a one-second isolated-client rollback soak, and clean up only resources they started. Set `LOCAL_ALPHA_SKIP_BUILD=1` for repetition only after the current production build has passed. The machine needs Docker and Chrome, Edge, or Chromium.

For a manual browser-only run:

1. Start `gravity-well-postgres` (or another local PostgreSQL instance), set `DATABASE_URL`, and run `npm run api:migrate`.
2. Start the API on `http://127.0.0.1:8787` and the web dev server on `http://127.0.0.1:5190`.
3. Run `npm run webrtc:browser-smoke` from the repository root.

For the release-duration local rehearsal, keep the same services running and use:

```bash
npm run webrtc:browser-soak -- --duration-seconds 1800 --output build-artifacts/webrtc-browser-soak-report.json
```

The soak defaults to 30 real-time minutes at 60 simulation frames per second, with authoritative input delivered in 12-frame windows and a maximum accepted rollback depth of 30 frames. `--frame-rate`, `--delivery-interval-frames`, `--max-rollback-depth-frames`, and `--minimum-duration-ratio` are explicit overrides. Use `WEBRTC_BROWSER_SMOKE_FORCE_RELAY=1` against a configured TURN service. The command writes a retained JSON report and fails on an undersized elapsed-time sample, checksum divergence, missing synchronization, excessive rollback depth, unacknowledged frames, protocol errors, transport operation failures, or a DataChannel disconnect.

Set `BROWSER_EXECUTABLE_PATH` when Chrome, Edge, or Chromium is outside a standard install location. `WEBRTC_BROWSER_SMOKE_URL`, `WEBRTC_BROWSER_SMOKE_API_BASE_URL`, and `WEBRTC_BROWSER_SMOKE_TIMEOUT_MS` override the defaults. `WEBRTC_BROWSER_SMOKE_FORCE_RELAY=1` requires relay policy, relay candidate pairs, relay availability, and time-limited credentials across both phases. The direct and forced-relay CI gates run a one-second real-time version of the isolated-client soak against disposable PostgreSQL 16, local coturn, a localhost API, Vite, and the Ubuntu runner's system Chrome. This proves the long-soak code path on every change without spending 30 hosted minutes per commit. A failing run retains its JSON report plus `apps/game-web/build-artifacts/webrtc-browser-smoke-failure.png` for CI artifact upload.

For interactive debugging of the deterministic core phase, open `/webrtc-smoke.html` and select **Run same-page rollback smoke**. The automated command additionally launches `/webrtc-peer-smoke.html` in two storage-isolated browser contexts; that phase is intentionally runner-controlled because each page must receive exactly one signed account/session binding.

The harness creates two signed guest accounts, exact-build matches them, and negotiates the real browser DataChannel through the authenticated signaling routes. An epoch-0 preflight exchanges one acknowledged frame each way and verifies account routing. Epoch 1 then advances two local rollback clients for 120 frames while withholding authoritative inputs in deterministic 12-frame windows. Every batch crosses the DataChannel, each peer must record checksum-changing rollback corrections, both peers must confirm frame 119, and both final states must equal a separately stepped canonical simulation.

The `gw.webrtc-browser-smoke.v7` report contains a `gw.webrtc-browser-core-smoke.v2` deterministic core phase and records whether relay was requested, relay readiness, both ICE policies, both credential modes, and selected connection paths. Recovery closes the real DataChannel, marks both participants disconnected, advances transport generation `1 -> 2`, proves stale-attempt rejection, restores durable server presence before potentially slow ICE negotiation, agrees checksum `1690434014` at confirmed frame 119, and exchanges/acknowledges frame 120 through the preserved transport. It then runs the production session-lifecycle controller against the same live session. Synthetic browser `visibilitychange` plus `pagehide` events must result in one authenticated disconnect, an immutable reconnect deadline, one nonce-protected reconnect, resumed heartbeat ownership, and an epoch-2 frame exchange over the recovered DataChannel.

The v7 report also requires `gw.webrtc-two-client-smoke.v4`: two separate browser contexts with isolated storage receive one signed account and one side-specific match contract each. Those documents independently run the production signaling, frame-transport, heartbeat, disconnect, and reconnect modules; open a real DataChannel; exchange and acknowledge one frame per side; preserve remote account identity; confirm frame `0`; and resolve the server session through two completion attestations. When soak mode is enabled, the same two pages expose the production batched `OnlineFrameTransport` contract to two deterministic rollback sessions. Every delayed batch crosses the live DataChannel; the `gw.webrtc-two-client-rollback-soak.v1` result retains elapsed duration, ACK and operation counters, disconnect/protocol diagnostics, rollback corrections and depth, confirmation cursors, and canonical checksums.

The v4 two-client phase also emits `gw.webrtc-two-client-lifecycle-stall.v1`. It suspends one peer through the production lifecycle controller, requires the server to retain an immutable reconnect deadline while the other peer stays connected, freezes the Chrome page and disables script execution through CDP for a bounded portion of the reconnect grace period, restores a working page timer, performs the nonce-protected reconnect, and exchanges and confirms fresh epoch-2 traffic in both directions. This is deterministic browser lifecycle/script-stall emulation. It is not evidence for operating-system background throttling, device sleep, Wi-Fi handoff, or cross-network recovery.

`gw.ranked-root-browser-smoke.v4` separately drives two isolated browser processes through the production application root, signed guest bootstrap, ranked matchmaking, the live match loop, canonical replay persistence, proof-consensus settlement, rating persistence, and readback. Its loopback-only build uses a dynamically loaded one-poll delay for the first inbound batch of each round plus one symmetric non-neutral input probe, so both clients must predict and then apply real authoritative correction without imposing artificial latency on the rest of the match. While both clients still hold speculative unacknowledged inputs, v4 pauses simulation and transport flushing, replaces the real WebRTC channel, and requires the peers to agree on a checkpoint that excludes that tail. It then requires exactly one transport-generation advance, the original round epoch, resumed and fully drained retained inputs, and zero conflicting or too-late frames before settlement. The harness also fails unless both clients record rollback depth, drain the initial delayed batch, converge on one score/proof/replay, and report no transport or page failure. The impairment cannot be requested outside an HTTP loopback origin and is absent from normal online behavior. Any storage leak, identity mismatch, ICE-policy mismatch, non-relay path in forced mode, missing ACK/confirmation, excessive rollback, divergence, page error, or console error fails the appropriate gate. Local forced TURN proves relay wiring but does not substitute for real operating-system backgrounding or cross-network recovery. The browser-only command closes its browser but leaves manually started services under operator control; the local integration commands own and clean up their isolated API, preview, and optional coturn container.

## Production requirements

Configure all of the following before enabling the online-match runtime outside development:

```text
MATCHMAKING_STUN_URLS=stun:...
MATCHMAKING_TURN_URLS=turn:...?transport=udp,turns:...?transport=tcp
MATCHMAKING_TURN_SHARED_SECRET=<coturn_rest_api_shared_secret>
MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS=600
MATCHMAKING_DIRECT_CONNECT_TIMEOUT_MS=8000
MATCHMAKING_SIGNAL_TTL_SECONDS=600
MATCHMAKING_RECONNECT_GRACE_SECONDS=20
```

The public `/matchmaking/network/status` route reports relay readiness without returning ICE URLs or credentials. The `POST /matchmaking/network/ice-config` route issues an account-scoped coturn REST username and HMAC credential with a short expiry only after validating both the bearer session and active matchmaking session token. Staging and production clients refuse to start a match when `relayAvailable` is false. The hosted safe-rollout workflow always requires TURN and refuses to resume matchmaking unless it uses `time_limited` credentials.

GET polling for signaling and ranked settlement sends the opaque participant credential in `x-match-session-token`. It must not be placed in a query string because request URLs are routinely retained by API, proxy, and browser logs.

`MATCHMAKING_TURN_USERNAME` plus `MATCHMAKING_TURN_CREDENTIAL` remains available for local compatibility, but it exposes the same permanent credential to every authenticated client and does not pass the alpha TURN gate.

The old HTTP frame endpoints are disabled by default, cannot be enabled when `NODE_ENV=production`, and exist only for an explicitly opted-in local API-security smoke. Their backing store is process memory; they are never an alpha fallback or gameplay transport.

## Remaining live gates

- Two remote browsers across different networks using the hosted TURN deployment, first forced and then with normal ICE selection.
- Real operating-system background suspension, clock stall, Wi-Fi handoff, and cross-network recovery drills.
- A 30-minute deployed match soak with retained rollback and connection diagnostics.
- Forced API replacement while an established peer data plane is active, followed by ranked settlement.
