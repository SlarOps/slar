-- Create notification queues
-- For incident assignment notifications
SELECT pgmq.create('incident_notifications');

-- For general notifications (future use)
SELECT pgmq.create('general_notifications');

-- For Slack UI feedback (Optimistic UI pattern)
SELECT pgmq.create('slack_feedback');

-- Create notification_configs table to store user notification preferences
CREATE TABLE IF NOT EXISTS public.user_notification_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    
    -- Slack configuration
    slack_user_id VARCHAR(50),     -- Slack user ID (@U1234567890)
    slack_channel_id VARCHAR(50),  -- Preferred Slack channel ID
    slack_enabled BOOLEAN DEFAULT true,
    
    -- Email configuration (for future use)
    email_enabled BOOLEAN DEFAULT true,
    email_address VARCHAR(255),
    
    -- SMS configuration (for future use)  
    sms_enabled BOOLEAN DEFAULT false,
    phone_number VARCHAR(20),
    
    -- Push notification configuration
    push_enabled BOOLEAN DEFAULT true,
    
    -- General preferences
    notification_timezone VARCHAR(50) DEFAULT 'UTC',
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one config per user
    UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_notification_configs_user_id 
ON public.user_notification_configs(user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_notification_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_notification_configs_updated_at 
ON public.user_notification_configs;

CREATE TRIGGER trigger_update_notification_configs_updated_at
    BEFORE UPDATE ON public.user_notification_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_notification_configs_updated_at();

-- Create notification_logs table to track sent notifications
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
    
    -- Notification details
    notification_type VARCHAR(50) NOT NULL, -- 'incident_assigned', 'incident_escalated', etc.
    channel VARCHAR(20) NOT NULL,           -- 'slack', 'email', 'sms', 'push'
    recipient VARCHAR(255) NOT NULL,        -- slack user id, email, phone number
    
    -- Message content
    title VARCHAR(255),
    message TEXT,
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'sent', 'failed', 'retrying'
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    retry_count INTEGER DEFAULT 0,
    
    -- External references
    external_message_id VARCHAR(255),      -- Slack message timestamp, email ID, etc.
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for notification logs
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id 
ON public.notification_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_incident_id 
ON public.notification_logs(incident_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_status 
ON public.notification_logs(status);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at 
ON public.notification_logs(created_at DESC);

-- Create updated_at trigger for notification_logs
DROP TRIGGER IF EXISTS trigger_update_notification_logs_updated_at 
ON public.notification_logs;

CREATE TRIGGER trigger_update_notification_logs_updated_at
    BEFORE UPDATE ON public.notification_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_notification_configs_updated_at();

-- Insert some sample notification configurations for existing users
-- (This is optional - users can configure later via UI)
INSERT INTO public.user_notification_configs (user_id, slack_enabled, email_enabled, push_enabled)
SELECT id, true, true, true FROM public.users 
WHERE NOT EXISTS (
    SELECT 1 FROM public.user_notification_configs nc WHERE nc.user_id = public.users.id
)
ON CONFLICT (user_id) DO NOTHING;

COMMENT ON TABLE public.user_notification_configs IS 'Store user notification preferences for different channels';
COMMENT ON TABLE public.notification_logs IS 'Track all sent notifications for auditing and debugging';
COMMENT ON COLUMN public.user_notification_configs.slack_user_id IS 'Slack user ID in format @U1234567890';
COMMENT ON COLUMN public.user_notification_configs.slack_channel_id IS 'Preferred Slack channel ID for notifications';
