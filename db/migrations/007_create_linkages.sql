CREATE TYPE relationship_type AS ENUM ('parent', 'guardian', 'other');

CREATE TABLE parent_child_linkages (
    linkage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_signet_pubkey TEXT NOT NULL,
    child_signet_pubkey TEXT NOT NULL,
    relationship relationship_type NOT NULL,
    verified_by UUID NOT NULL REFERENCES staff(staff_id),
    club_id UUID NOT NULL REFERENCES clubs(club_id),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    nostr_event_id TEXT,
    UNIQUE(parent_signet_pubkey, child_signet_pubkey)
);
