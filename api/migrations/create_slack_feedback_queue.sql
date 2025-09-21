-- Create slack_feedback queue for Optimistic UI feedback
-- This queue handles feedback messages from Go workers back to Python Slack worker
-- for updating Slack UI after processing actions (acknowledge, resolve, etc.)

-- Create the PGMQ queue
SELECT pgmq.create('slack_feedback');

-- Add comment for documentation
COMMENT ON SCHEMA pgmq IS 'PostgreSQL Message Queue extension for handling asynchronous tasks';

-- Log the creation
DO $$
BEGIN
    RAISE NOTICE 'Created slack_feedback queue for Optimistic UI feedback from workers to Slack';
END $$;
