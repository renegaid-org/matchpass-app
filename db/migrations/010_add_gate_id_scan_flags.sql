-- Add gate_id to scan_log for multi-gate tracking
ALTER TABLE scan_log ADD COLUMN gate_id TEXT;
CREATE INDEX idx_scan_log_gate ON scan_log(gate_id);

-- Duplicate scan flags — officer review queue
CREATE TABLE duplicate_scan_flags (
    flag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fan_signet_pubkey TEXT NOT NULL,
    club_id UUID NOT NULL REFERENCES clubs(club_id),
    match_date DATE NOT NULL,
    first_scan_id UUID REFERENCES scan_log(scan_id),
    second_scan_id UUID REFERENCES scan_log(scan_id),
    first_gate_id TEXT,
    second_gate_id TEXT,
    notes TEXT,
    dismissed_by UUID REFERENCES staff(staff_id),
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dup_flags_club_date ON duplicate_scan_flags(club_id, match_date);
CREATE INDEX idx_dup_flags_open ON duplicate_scan_flags(club_id) WHERE dismissed_at IS NULL;
