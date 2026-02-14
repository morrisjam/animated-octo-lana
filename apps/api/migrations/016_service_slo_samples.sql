CREATE TABLE IF NOT EXISTS service_slo_request_samples (
  sample_id BIGSERIAL PRIMARY KEY,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code >= 100 AND status_code <= 599),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS service_slo_request_samples_sampled_idx
  ON service_slo_request_samples(sampled_at DESC);

CREATE INDEX IF NOT EXISTS service_slo_request_samples_route_idx
  ON service_slo_request_samples(route, sampled_at DESC);
