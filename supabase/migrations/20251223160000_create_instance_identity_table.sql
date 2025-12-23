-- Create table to store instance identity (private key)
-- This ensures the key persists across pod restarts in K8s
CREATE TABLE IF NOT EXISTS instance_identity (
    instance_id TEXT PRIMARY KEY,
    private_key_pem TEXT NOT NULL,
    public_key_pem TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE instance_identity IS 'Stores instance ECDSA keypair for Zero-Trust authentication. Ensures key persistence across K8s pod restarts.';

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_instance_identity_updated_at ON instance_identity(updated_at);
