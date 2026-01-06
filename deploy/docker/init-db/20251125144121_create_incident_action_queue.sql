-- Create incident_actions queue for processing incident actions (acknowledge, resolve, etc.)
-- This queue handles actions triggered from external sources (Slack, webhooks, etc.)
-- and routes them through the proper API layer for consistent business logic

-- Create the PGMQ queue
SELECT pgmq.create('incident_actions');

-- Add comment for documentation
COMMENT ON SCHEMA pgmq IS 'PostgreSQL Message Queue extension for handling asynchronous tasks';

-- Log the creation
DO $$
BEGIN
    RAISE NOTICE 'Created incident_actions queue for processing incident actions';
END $$;
