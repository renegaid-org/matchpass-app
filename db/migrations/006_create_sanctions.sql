CREATE TYPE sanction_type AS ENUM ('suspension', 'ban');
CREATE TYPE sanction_status AS ENUM ('active', 'appealed', 'expired', 'overturned');

CREATE TABLE sanctions (
    sanction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sanction_type sanction_type NOT NULL,
    fan_signet_pubkey TEXT NOT NULL,
    issued_by_club UUID NOT NULL REFERENCES clubs(club_id),
    reason TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    match_count INTEGER,
    status sanction_status NOT NULL DEFAULT 'active',
    appeal_text TEXT,
    appeal_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    nostr_event_id TEXT
);
CREATE INDEX idx_sanctions_fan ON sanctions(fan_signet_pubkey);
CREATE INDEX idx_sanctions_status ON sanctions(status);
