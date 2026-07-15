# Local Rollback Network Soak

The rollback soak is an accelerated, deterministic local gate. It uses no browser, database, Neon project, or hosted compute.

Run it from the repository root:

```powershell
npm run rollback:soak
```

The default `local-alpha-adverse-v1` profile simulates 3,600 gameplay frames with 100 ms base one-way latency, up to four frames of jitter, 5% packet-attempt loss, packet reordering, duplication, acknowledged retry, and a final drain. It runs P1-local and P2-local rollback sessions beside a canonical no-network simulation. The command fails unless both clients converge to the canonical checksum with no unrecovered input and remain inside the configured rollback-depth and recovery-age budgets.

The JSON report is written to:

`apps/game-web/build-artifacts/rollback-network-soak-report.json`

Useful overrides:

```powershell
npm run rollback:soak -- --frames 18000 --seed 20260713
npm run rollback:soak -- --latency-frames 8 --jitter-frames 5 --loss-rate 0.08
```

## What it measures

- Exact final checksum convergence for both player mappings.
- Rollback depth p50, p95, p99, and maximum per client.
- Packet attempts, drops, retries, reordering, duplication, and frame recovery age.
- Predicted advance frames, correction events, drain duration, pending input, and unrecovered input.
- Deterministic reproduction by profile and seed.

## Related live-path checks

The browser's `OnlineInputPump` has separate unit coverage for durable upload retry, full-batch acknowledgement, contiguous receive cursors, duplicate/conflict detection, round-epoch isolation, and two-way decisive-frame confirmation. `WebRtcFrameTransport` adds linked-channel protocol tests for application ACKs, retry deduplication, account routing, malformed messages, conflicts, timeouts, and closure. The dev-only `/webrtc-smoke.html` page exercises two real browser peers through authenticated PostgreSQL signaling and verifies bidirectional frame delivery and confirmation without Neon. `npm run webrtc:browser-soak -- --duration-seconds 1800` adds a real-time companion: two storage-isolated pages carry every delayed input batch while paired rollback sessions retain ACK, operation, disconnect, correction-depth, confirmation, and checksum evidence.

The accelerated impairment soak and same-machine browser soak are complementary. The first models packet loss, jitter, duplication, and reordering without a browser; the second uses the production reliable DataChannel but does not inject internet loss. Neither proves cross-network behavior, browser clock skew, real operating-system tab suspension, hosted TURN, DataChannel re-negotiation, or deployed latency. Those remain staging gates. Their purpose is to reject deterministic rollback, protocol, and sustained-transport regressions cheaply before hosted tests.
