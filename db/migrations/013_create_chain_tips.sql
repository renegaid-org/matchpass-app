CREATE TABLE chain_tips (
    fan_pubkey TEXT PRIMARY KEY,
    tip_event_id TEXT NOT NULL,
    tip_status SMALLINT NOT NULL DEFAULT 0,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_chain_tips_last_seen ON chain_tips(last_seen);
