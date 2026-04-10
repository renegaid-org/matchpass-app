CREATE TABLE gate_locks (
    lock_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fan_signet_pubkey TEXT NOT NULL,
    photo_hash TEXT NOT NULL,
    season_id UUID NOT NULL REFERENCES seasons(season_id),
    locked_by_staff UUID NOT NULL REFERENCES staff(staff_id),
    club_id UUID NOT NULL REFERENCES clubs(club_id),
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(fan_signet_pubkey, season_id)
);
CREATE INDEX idx_gate_locks_fan ON gate_locks(fan_signet_pubkey);
