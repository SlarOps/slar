-- Create notification queues
-- For incident assignment notifications
SELECT pgmq.create('incident_notifications');

-- For general notifications (future use)
SELECT pgmq.create('general_notifications');

-- For Slack UI feedback (Optimistic UI pattern)
SELECT pgmq.create('slack_feedback');
