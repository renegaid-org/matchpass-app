CREATE TYPE scan_type AS ENUM ('gate_entry', 'roaming_check');
CREATE TYPE scan_result AS ENUM ('green', 'amber', 'red', 'mismatch');

CREATE TABLE scan_log (
    scan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fan_signet_pubkey TEXT NOT NULL,
    staff_id UUID NOT NULL REFERENCES staff(staff_id),
    club_id UUID NOT NULL REFERENCES clubs(club_id),
    match_date DATE NOT NULL,
    scan_type scan_type NOT NULL,
    result scan_result NOT NULL,
    photo_hash_matched BOOLEAN NOT NULL,
    gate_locked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scan_log_date ON scan_log(match_date);
CREATE INDEX idx_scan_log_fan ON scan_log(fan_signet_pubkey);
