CREATE TYPE card_type AS ENUM ('yellow', 'red');
CREATE TYPE card_status AS ENUM (
    'active', 'challenged', 'expired', 'dismissed', 'escalated'
);
CREATE TYPE review_outcome AS ENUM ('confirmed', 'downgraded', 'dismissed');

CREATE TABLE cards (
    card_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_type card_type NOT NULL,
    fan_signet_pubkey TEXT NOT NULL,
    issued_by UUID NOT NULL REFERENCES staff(staff_id),
    club_id UUID NOT NULL REFERENCES clubs(club_id),
    season_id UUID NOT NULL REFERENCES seasons(season_id),
    match_date DATE NOT NULL,
    category TEXT NOT NULL,
    notes TEXT CHECK (char_length(notes) <= 280),
    seat_or_location TEXT,
    status card_status NOT NULL DEFAULT 'active',
    challenge_text TEXT,
    challenge_at TIMESTAMPTZ,
    review_deadline TIMESTAMPTZ,
    reviewed_by UUID REFERENCES staff(staff_id),
    review_outcome review_outcome,
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    clean_matches INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    nostr_event_id TEXT
);
CREATE INDEX idx_cards_fan ON cards(fan_signet_pubkey);
CREATE INDEX idx_cards_club ON cards(club_id);
CREATE INDEX idx_cards_status ON cards(status);
