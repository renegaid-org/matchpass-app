CREATE TABLE unlinked_cards (
    unlinked_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_type card_type NOT NULL,
    issued_by UUID NOT NULL REFERENCES staff(staff_id),
    club_id UUID NOT NULL REFERENCES clubs(club_id),
    match_date DATE NOT NULL,
    category TEXT NOT NULL,
    notes TEXT,
    seat_or_location TEXT,
    description TEXT NOT NULL,
    linked_card_id UUID REFERENCES cards(card_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
