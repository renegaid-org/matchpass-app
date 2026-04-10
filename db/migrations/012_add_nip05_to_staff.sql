-- Add optional NIP-05 identifier for display and cross-verification
ALTER TABLE staff ADD COLUMN IF NOT EXISTS nip05 TEXT;
