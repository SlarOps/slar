-- Add DNS and Certificate monitoring fields to monitors table

-- DNS monitoring fields
ALTER TABLE monitors 
ADD COLUMN IF NOT EXISTS dns_record_type VARCHAR(10),
ADD COLUMN IF NOT EXISTS expected_values TEXT[];

-- Certificate monitoring fields  
ALTER TABLE monitors
ADD COLUMN IF NOT EXISTS cert_expiry_days_warning INTEGER DEFAULT 30;

-- Add comments for documentation
COMMENT ON COLUMN monitors.dns_record_type IS 'DNS record type for DNS monitors (A, AAAA, CNAME, MX, TXT)';
COMMENT ON COLUMN monitors.expected_values IS 'Expected DNS resolution values or certificate properties';
COMMENT ON COLUMN monitors.cert_expiry_days_warning IS 'Days before certificate expiry to trigger warning';
