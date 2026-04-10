CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE clubs (
    club_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    fa_affiliation TEXT,
    ground_name TEXT,
    league TEXT,
    nostr_pubkey TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
