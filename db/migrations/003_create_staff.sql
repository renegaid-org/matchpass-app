CREATE TYPE staff_role AS ENUM (
    'gate_steward', 'roaming_steward', 'safety_officer',
    'safeguarding_officer', 'admin'
);

CREATE TABLE staff (
    staff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES clubs(club_id),
    signet_pubkey TEXT NOT NULL,
    display_name TEXT,
    role staff_role NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(club_id, signet_pubkey)
);
CREATE INDEX idx_staff_club ON staff(club_id);
CREATE INDEX idx_staff_pubkey ON staff(signet_pubkey);
