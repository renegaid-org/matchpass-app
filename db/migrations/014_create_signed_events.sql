CREATE TABLE signed_events (
    event_id TEXT PRIMARY KEY,
    kind INTEGER NOT NULL,
    fan_pubkey TEXT NOT NULL,
    content JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_signed_events_fan ON signed_events(fan_pubkey);
CREATE INDEX idx_signed_events_kind ON signed_events(kind);
