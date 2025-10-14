# Hybrid Notification Routing Implementation Guide

## 📋 Overview

Tài liệu này mô tả cách triển khai **Hybrid Notification Routing** để mở rộng hệ thống notification từ Slack sang multi-channel (Email, Teams, Discord, etc.) với **tối thiểu thay đổi** và **tận dụng tối đa** infrastructure hiện có.

**Approach:** Option 1 - Tận dụng tối đa database và PGMQ hiện tại.

---

## 🎯 Kiến trúc tổng quan

```
┌────────────────────────────────────────────────────┐
│   Application Services (Go)                        │
│   └─ SendNotification()                            │
│       │                                             │
│       ▼                                             │
│   PGMQ: incident_notifications (ĐÃ CÓ)            │
│   Message: {                                        │
│     type: "assigned/escalated/...",                │
│     user_id: "...",                                │
│     incident_id: "...",                            │
│     channels: ["slack", "email"],  ← NEW FIELD    │
│     priority: "high"                               │
│   }                                                 │
└────────────────────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────┐
│   NOTIFICATION ROUTER WORKER (Go) - NEW            │
│   - Poll incident_notifications                     │
│   - Get user_notification_configs                  │
│   - Filter channels by preferences & priority       │
│   - Route to appropriate workers                    │
│   - Log to notification_logs                       │
└────────────────────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
    ┌─────────┐  ┌─────────┐  ┌─────────┐
    │ Slack   │  │ Email   │  │ Teams   │
    │ Worker  │  │ Worker  │  │ Worker  │
    │(EXIST)  │  │ (NEW)   │  │ (NEW)   │
    └─────────┘  └─────────┘  └─────────┘
```

---

## 📊 Đánh giá Infrastructure hiện tại

### ✅ Có thể tận dụng

| Component | File | Status | Tận dụng |
|-----------|------|--------|----------|
| `user_notification_configs` | `api/migrations/setup_pgmq.sql` | ✅ Exists | 90% - cần thêm columns |
| `notification_logs` | `api/migrations/setup_pgmq.sql` | ✅ Exists | 95% - cần thêm columns |
| `users` table | `api/migrations/create_users.sql` | ✅ Exists | 100% - không cần thay đổi |
| `incident_notifications` queue | `api/migrations/setup_pgmq.sql` | ✅ Exists | 100% - không cần thay đổi |
| Slack Worker | `api/workers/slack_worker.py` | ✅ Exists | 100% - không cần thay đổi |

### ➕ Cần thêm mới

- Router Worker (Go)
- Email Worker (Go/Python)
- Teams Worker (Go) - optional
- Migration scripts

---

## 🚀 Implementation Roadmap

### Phase 1: Database Schema Extension (1-2 giờ)

#### Step 1.1: Tạo migration file mới

**File:** `api/migrations/add_notification_routing_support.sql`

```sql
-- ============================================================
-- Migration: Add Multi-Channel Notification Routing Support
-- Version: 1.0
-- Date: 2024-XX-XX
-- ============================================================

BEGIN;

-- ============================================================
-- 1. EXTEND user_notification_configs
-- ============================================================

-- Add multi-channel support
ALTER TABLE user_notification_configs 
ADD COLUMN IF NOT EXISTS teams_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS teams_user_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS discord_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS discord_user_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS webhook_url TEXT;

-- Add priority-based channel routing
ALTER TABLE user_notification_configs
ADD COLUMN IF NOT EXISTS high_priority_channels TEXT[] DEFAULT ARRAY['slack', 'email'],
ADD COLUMN IF NOT EXISTS medium_priority_channels TEXT[] DEFAULT ARRAY['slack'],
ADD COLUMN IF NOT EXISTS low_priority_channels TEXT[] DEFAULT ARRAY['email'];

-- Add email digest support
ALTER TABLE user_notification_configs
ADD COLUMN IF NOT EXISTS email_digest_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_digest_frequency VARCHAR(20) DEFAULT 'daily', -- 'hourly', 'daily', '12hours'
ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ;

-- Add do-not-disturb support (more flexible than quiet_hours)
ALTER TABLE user_notification_configs
ADD COLUMN IF NOT EXISTS dnd_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS dnd_schedule JSONB; -- Flexible schedule config

-- ============================================================
-- 2. EXTEND notification_logs
-- ============================================================

-- Add routing tracking
ALTER TABLE notification_logs
ADD COLUMN IF NOT EXISTS notification_id UUID, -- Link to original routing message
ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS metadata JSONB, -- Channel-specific metadata
ADD COLUMN IF NOT EXISTS priority VARCHAR(20); -- 'high', 'medium', 'low'

-- Add delivery tracking
ALTER TABLE notification_logs
ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- ============================================================
-- 3. CREATE INDEXES
-- ============================================================

-- Index for finding all deliveries of same notification
CREATE INDEX IF NOT EXISTS idx_notification_logs_notification_id 
ON notification_logs(notification_id);

-- Index for retry logic
CREATE INDEX IF NOT EXISTS idx_notification_logs_status_retry 
ON notification_logs(status, retry_count) 
WHERE status IN ('failed', 'retrying');

-- Index for digest processing
CREATE INDEX IF NOT EXISTS idx_notification_configs_digest 
ON user_notification_configs(email_digest_enabled, last_digest_sent_at)
WHERE email_digest_enabled = true;

-- ============================================================
-- 4. UPDATE EXISTING DATA
-- ============================================================

-- Set default priority channels for existing users
UPDATE user_notification_configs 
SET 
    high_priority_channels = ARRAY['slack', 'email'],
    medium_priority_channels = ARRAY['slack'],
    low_priority_channels = ARRAY['email']
WHERE high_priority_channels IS NULL;

-- ============================================================
-- 5. ADD COMMENTS
-- ============================================================

COMMENT ON COLUMN user_notification_configs.high_priority_channels IS 
'Channels to use for high priority notifications (P0, P1)';

COMMENT ON COLUMN user_notification_configs.medium_priority_channels IS 
'Channels to use for medium priority notifications (P2, P3)';

COMMENT ON COLUMN user_notification_configs.low_priority_channels IS 
'Channels to use for low priority notifications (P4, P5)';

COMMENT ON COLUMN user_notification_configs.email_digest_enabled IS 
'Enable email digest mode instead of immediate email notifications';

COMMENT ON COLUMN user_notification_configs.dnd_schedule IS 
'Flexible DND schedule in JSON format: {"days": [1,2,3,4,5], "start": "22:00", "end": "08:00"}';

COMMENT ON COLUMN notification_logs.notification_id IS 
'Links multiple channel deliveries of same notification for tracking';

COMMENT ON COLUMN notification_logs.metadata IS 
'Channel-specific metadata (e.g., email message_id, slack message_ts)';

COMMENT ON COLUMN notification_logs.priority IS 
'Notification priority that determined channel routing';

-- ============================================================
-- 6. CREATE HELPER VIEWS
-- ============================================================

-- View for notification delivery status
CREATE OR REPLACE VIEW notification_delivery_status AS
SELECT 
    nl.notification_id,
    nl.incident_id,
    nl.user_id,
    u.name as user_name,
    u.email as user_email,
    nl.notification_type,
    nl.priority,
    COUNT(*) as total_channels,
    COUNT(*) FILTER (WHERE nl.status = 'sent') as sent_count,
    COUNT(*) FILTER (WHERE nl.status = 'failed') as failed_count,
    COUNT(*) FILTER (WHERE nl.status = 'pending') as pending_count,
    MIN(nl.created_at) as first_created_at,
    MAX(nl.sent_at) as last_sent_at
FROM notification_logs nl
LEFT JOIN users u ON nl.user_id = u.id
WHERE nl.notification_id IS NOT NULL
GROUP BY nl.notification_id, nl.incident_id, nl.user_id, u.name, u.email, 
         nl.notification_type, nl.priority;

COMMENT ON VIEW notification_delivery_status IS 
'Aggregate view of notification delivery across all channels';

COMMIT;

-- ============================================================
-- Post-migration verification
-- ============================================================

DO $$
BEGIN
    -- Verify columns were added
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_notification_configs' 
        AND column_name = 'high_priority_channels'
    ) THEN
        RAISE EXCEPTION 'Migration failed: high_priority_channels column not created';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notification_logs' 
        AND column_name = 'notification_id'
    ) THEN
        RAISE EXCEPTION 'Migration failed: notification_id column not created';
    END IF;
    
    RAISE NOTICE '✅ Migration completed successfully';
    RAISE NOTICE '   - Extended user_notification_configs with % new columns', (
        SELECT COUNT(*) FROM information_schema.columns 
        WHERE table_name = 'user_notification_configs' 
        AND column_name IN ('teams_enabled', 'discord_enabled', 'high_priority_channels', 
                           'email_digest_enabled', 'dnd_enabled')
    );
    RAISE NOTICE '   - Extended notification_logs with % new columns', (
        SELECT COUNT(*) FROM information_schema.columns 
        WHERE table_name = 'notification_logs' 
        AND column_name IN ('notification_id', 'routed_at', 'metadata', 'priority')
    );
END $$;
```

#### Step 1.2: Chạy migration

```bash
# Development
psql -d slar_dev -f api/migrations/add_notification_routing_support.sql

# Production (sau khi test kỹ)
psql -d slar_prod -f api/migrations/add_notification_routing_support.sql

# Verify
psql -d slar_dev -c "\d+ user_notification_configs"
psql -d slar_dev -c "\d+ notification_logs"
```

---

### Phase 2: Update Application Services (2-3 giờ)

#### Step 2.1: Update NotificationSender interface

**File:** `api/services/incident.go`

```go
// Update SendIncidentAssignedNotification to support channels
func (l *LightweightNotificationSender) SendIncidentAssignedNotification(userID, incidentID string) error {
    notification := map[string]interface{}{
        "type":        "assigned",
        "user_id":     userID,
        "incident_id": incidentID,
        "channels":    []string{"slack", "email"}, // ← NEW: Support multiple channels
        "priority":    "high",
        "created_at":  time.Now(),
        "retry_count": 0,
    }

    notificationJSON, err := json.Marshal(notification)
    if err != nil {
        return fmt.Errorf("failed to marshal notification: %w", err)
    }

    _, err = l.PG.Exec(`SELECT pgmq.send($1, $2)`, "incident_notifications", string(notificationJSON))
    if err != nil {
        return fmt.Errorf("failed to send notification to queue: %w", err)
    }

    return nil
}

// Tương tự cho các functions khác:
// - SendIncidentEscalatedNotification
// - SendIncidentAcknowledgedNotification  
// - SendIncidentResolvedNotification
```

#### Step 2.2: Add helper function để determine channels

**File:** `api/services/notification_helpers.go` (NEW)

```go
package services

import (
    "database/sql"
    "encoding/json"
)

type NotificationChannels struct {
    Slack   bool
    Email   bool
    Teams   bool
    Discord bool
    Push    bool
}

// GetChannelsForPriority returns appropriate channels based on priority and user preferences
func GetChannelsForPriority(pg *sql.DB, userID string, priority string) ([]string, error) {
    var highChannels, mediumChannels, lowChannels []string
    
    query := `
        SELECT high_priority_channels, medium_priority_channels, low_priority_channels
        FROM user_notification_configs
        WHERE user_id = $1
    `
    
    var highJSON, mediumJSON, lowJSON []byte
    err := pg.QueryRow(query, userID).Scan(&highJSON, &mediumJSON, &lowJSON)
    if err != nil {
        // Default fallback
        return []string{"slack", "email"}, nil
    }
    
    json.Unmarshal(highJSON, &highChannels)
    json.Unmarshal(mediumJSON, &mediumChannels)
    json.Unmarshal(lowJSON, &lowChannels)
    
    switch priority {
    case "high", "critical":
        return highChannels, nil
    case "medium":
        return mediumChannels, nil
    case "low":
        return lowChannels, nil
    default:
        return mediumChannels, nil
    }
}

// IsChannelEnabled checks if a specific channel is enabled for user
func IsChannelEnabled(pg *sql.DB, userID string, channel string) (bool, error) {
    var enabled bool
    columnName := channel + "_enabled"
    
    query := `SELECT ` + columnName + ` FROM user_notification_configs WHERE user_id = $1`
    err := pg.QueryRow(query, userID).Scan(&enabled)
    if err != nil {
        return false, err
    }
    
    return enabled, nil
}
```

---

### Phase 3: Implement Router Worker (2-3 ngày)

#### Step 3.1: Tạo Router Worker structure

**File:** `api/workers/notification_router.go` (NEW)

```go
package workers

import (
    "database/sql"
    "encoding/json"
    "log"
    "time"
    "github.com/vanchonlee/slar/services"
)

type NotificationRouter struct {
    PG          *sql.DB
    PollInterval time.Duration
    BatchSize    int
}

type RoutingMessage struct {
    NotificationID string    `json:"notification_id"`
    Type          string    `json:"type"`
    UserID        string    `json:"user_id"`
    IncidentID    string    `json:"incident_id"`
    Channels      []string  `json:"channels"`
    Priority      string    `json:"priority"`
    Metadata      map[string]interface{} `json:"metadata"`
    CreatedAt     time.Time `json:"created_at"`
    RetryCount    int       `json:"retry_count"`
}

func NewNotificationRouter(pg *sql.DB) *NotificationRouter {
    return &NotificationRouter{
        PG:           pg,
        PollInterval: 1 * time.Second,
        BatchSize:    10,
    }
}

// Start begins the router worker loop
func (r *NotificationRouter) Start() {
    log.Println("🚀 Notification Router Worker started")
    
    ticker := time.NewTicker(r.PollInterval)
    defer ticker.Stop()
    
    for range ticker.C {
        r.processMessages()
    }
}

// processMessages reads from incident_notifications queue and routes
func (r *NotificationRouter) processMessages() {
    // Read messages from PGMQ
    rows, err := r.PG.Query(`
        SELECT * FROM pgmq.read('incident_notifications', 30, $1)
    `, r.BatchSize)
    
    if err != nil {
        log.Printf("❌ Error reading queue: %v", err)
        return
    }
    defer rows.Close()
    
    for rows.Next() {
        var msgID int64
        var readCt int
        var enqueuedAt, vt time.Time
        var messageJSON string
        
        err := rows.Scan(&msgID, &readCt, &enqueuedAt, &vt, &messageJSON)
        if err != nil {
            log.Printf("❌ Error scanning row: %v", err)
            continue
        }
        
        // Parse message
        var msg RoutingMessage
        err = json.Unmarshal([]byte(messageJSON), &msg)
        if err != nil {
            log.Printf("❌ Error parsing message: %v", err)
            r.deleteMessage(msgID)
            continue
        }
        
        // Route message
        success := r.routeMessage(&msg)
        
        if success {
            r.deleteMessage(msgID)
        } else if readCt > 3 {
            log.Printf("⚠️  Message %d exceeded max retries, moving to DLQ", msgID)
            r.deleteMessage(msgID)
        }
    }
}

// routeMessage handles the routing logic
func (r *NotificationRouter) routeMessage(msg *RoutingMessage) bool {
    log.Printf("📨 Routing notification: Type=%s, User=%s, Incident=%s, Channels=%v",
        msg.Type, msg.UserID[:8], msg.IncidentID[:8], msg.Channels)
    
    // 1. Get user preferences
    prefs, err := r.getUserPreferences(msg.UserID)
    if err != nil {
        log.Printf("❌ Failed to get user preferences: %v", err)
        return false
    }
    
    // 2. Filter channels based on preferences
    enabledChannels := r.filterChannels(msg.Channels, prefs, msg.Priority)
    
    // 3. Check quiet hours / DND
    enabledChannels = r.applyQuietHours(enabledChannels, prefs, msg.Priority)
    
    log.Printf("✅ Filtered channels: %v → %v (priority: %s)", 
        msg.Channels, enabledChannels, msg.Priority)
    
    // 4. Route to each enabled channel
    successCount := 0
    for _, channel := range enabledChannels {
        success := r.routeToChannel(msg, channel, prefs)
        if success {
            successCount++
        }
    }
    
    // Consider success if at least one channel succeeded
    return successCount > 0
}

// getUserPreferences fetches user notification configuration
func (r *NotificationRouter) getUserPreferences(userID string) (*UserNotificationConfig, error) {
    var config UserNotificationConfig
    
    err := r.PG.QueryRow(`
        SELECT 
            slack_enabled, slack_user_id,
            email_enabled, email_address,
            teams_enabled, teams_user_id,
            push_enabled,
            high_priority_channels,
            medium_priority_channels,
            low_priority_channels,
            quiet_hours_start, quiet_hours_end,
            notification_timezone,
            dnd_enabled, dnd_schedule
        FROM user_notification_configs
        WHERE user_id = $1
    `, userID).Scan(
        &config.SlackEnabled, &config.SlackUserID,
        &config.EmailEnabled, &config.EmailAddress,
        &config.TeamsEnabled, &config.TeamsUserID,
        &config.PushEnabled,
        &config.HighPriorityChannels,
        &config.MediumPriorityChannels,
        &config.LowPriorityChannels,
        &config.QuietHoursStart, &config.QuietHoursEnd,
        &config.Timezone,
        &config.DNDEnabled, &config.DNDSchedule,
    )
    
    if err != nil {
        return nil, err
    }
    
    return &config, nil
}

// filterChannels filters channels based on user preferences
func (r *NotificationRouter) filterChannels(
    requestedChannels []string,
    prefs *UserNotificationConfig,
    priority string,
) []string {
    var filtered []string
    
    for _, channel := range requestedChannels {
        switch channel {
        case "slack":
            if prefs.SlackEnabled && prefs.SlackUserID != "" {
                filtered = append(filtered, channel)
            }
        case "email":
            if prefs.EmailEnabled && prefs.EmailAddress != "" {
                filtered = append(filtered, channel)
            }
        case "teams":
            if prefs.TeamsEnabled && prefs.TeamsUserID != "" {
                filtered = append(filtered, channel)
            }
        case "push":
            if prefs.PushEnabled {
                filtered = append(filtered, channel)
            }
        }
    }
    
    return filtered
}

// applyQuietHours applies quiet hours and DND rules
func (r *NotificationRouter) applyQuietHours(
    channels []string,
    prefs *UserNotificationConfig,
    priority string,
) []string {
    // High priority bypasses quiet hours
    if priority == "high" || priority == "critical" {
        return channels
    }
    
    // Check DND
    if prefs.DNDEnabled && r.isInDNDPeriod(prefs) {
        log.Printf("🔕 User in DND period, removing non-critical channels")
        return []string{} // Block all for non-high priority
    }
    
    // Check quiet hours
    if r.isInQuietHours(prefs) {
        // During quiet hours, only allow email for low priority
        var filtered []string
        for _, ch := range channels {
            if ch == "email" {
                filtered = append(filtered, ch)
            }
        }
        return filtered
    }
    
    return channels
}

// routeToChannel sends message to specific channel worker
func (r *NotificationRouter) routeToChannel(
    msg *RoutingMessage,
    channel string,
    prefs *UserNotificationConfig,
) bool {
    // Generate unique notification_id for tracking
    notificationID := generateUUID()
    
    // Log routing attempt
    logID := r.logNotificationAttempt(msg, channel, notificationID)
    
    var success bool
    
    switch channel {
    case "slack":
        success = r.routeToSlackWorker(msg, prefs)
    case "email":
        success = r.routeToEmailWorker(msg, prefs)
    case "teams":
        success = r.routeToTeamsWorker(msg, prefs)
    case "push":
        success = r.sendPushNotification(msg, prefs)
    default:
        log.Printf("⚠️  Unknown channel: %s", channel)
        success = false
    }
    
    // Update log status
    if success {
        r.updateLogStatus(logID, "sent")
    } else {
        r.updateLogStatus(logID, "failed")
    }
    
    return success
}

// routeToSlackWorker sends directly to Slack worker (current implementation)
func (r *NotificationRouter) routeToSlackWorker(msg *RoutingMessage, prefs *UserNotificationConfig) bool {
    // Current Slack worker already polls incident_notifications
    // So we don't need to do anything here - message is already in the queue
    // Slack worker will pick it up
    
    // In future, we could send to a dedicated slack_notifications queue
    log.Printf("✅ Routed to Slack worker (user: %s)", prefs.SlackUserID)
    return true
}

// routeToEmailWorker sends to email worker (to be implemented)
func (r *NotificationRouter) routeToEmailWorker(msg *RoutingMessage, prefs *UserNotificationConfig) bool {
    // TODO: Implement email worker routing
    log.Printf("📧 Would send email to: %s (not implemented yet)", prefs.EmailAddress)
    return true // Return true for now to not block
}

// Helper functions
func (r *NotificationRouter) deleteMessage(msgID int64) {
    _, err := r.PG.Exec(`SELECT pgmq.delete('incident_notifications', $1)`, msgID)
    if err != nil {
        log.Printf("❌ Failed to delete message %d: %v", msgID, err)
    }
}

func (r *NotificationRouter) logNotificationAttempt(
    msg *RoutingMessage,
    channel string,
    notificationID string,
) string {
    var logID string
    err := r.PG.QueryRow(`
        INSERT INTO notification_logs (
            notification_id, user_id, incident_id, notification_type,
            channel, recipient, status, priority, routed_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING id
    `, notificationID, msg.UserID, msg.IncidentID, msg.Type,
       channel, "", "pending", msg.Priority).Scan(&logID)
    
    if err != nil {
        log.Printf("❌ Failed to log notification: %v", err)
    }
    
    return logID
}

func (r *NotificationRouter) updateLogStatus(logID string, status string) {
    _, err := r.PG.Exec(`
        UPDATE notification_logs 
        SET status = $1, sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END
        WHERE id = $2
    `, status, logID)
    
    if err != nil {
        log.Printf("❌ Failed to update log status: %v", err)
    }
}

// Type definitions
type UserNotificationConfig struct {
    SlackEnabled   bool
    SlackUserID    string
    EmailEnabled   bool
    EmailAddress   string
    TeamsEnabled   bool
    TeamsUserID    string
    PushEnabled    bool
    
    HighPriorityChannels   []string
    MediumPriorityChannels []string
    LowPriorityChannels    []string
    
    QuietHoursStart *time.Time
    QuietHoursEnd   *time.Time
    Timezone        string
    
    DNDEnabled  bool
    DNDSchedule map[string]interface{}
}

func (r *NotificationRouter) isInQuietHours(prefs *UserNotificationConfig) bool {
    // TODO: Implement quiet hours logic
    return false
}

func (r *NotificationRouter) isInDNDPeriod(prefs *UserNotificationConfig) bool {
    // TODO: Implement DND logic
    return false
}

func generateUUID() string {
    // TODO: Implement UUID generation
    return "uuid-placeholder"
}
```

#### Step 3.2: Integrate Router vào cmd/worker/main.go

**File:** `api/cmd/worker/main.go`

```go
// Add to main.go

func main() {
    // ... existing code ...
    
    // Start Notification Router
    router := workers.NewNotificationRouter(pg)
    go router.Start()
    
    // ... existing code ...
}
```

---

### Phase 4: Update Slack Worker (minimal, 1 giờ)

**Slack Worker hiện tại không cần thay đổi nhiều**, chỉ cần đảm bảo nó skip messages đã được router xử lý.

**File:** `api/workers/slack_worker.py`

Thêm vào `process_notification`:

```python
def process_notification(self, notification_msg: Dict[str, Any]) -> bool:
    try:
        # Check if this message was already routed
        # If notification_id exists in notification_logs with status='sent' for slack
        # then router already handled it, skip
        
        if self.was_already_routed(notification_msg):
            logger.info(f"📨 Message already routed by router worker, skipping")
            return True
        
        # ... existing code ...
```

Thêm helper:

```python
def was_already_routed(self, notification_msg: Dict) -> bool:
    """Check if router already processed this message"""
    try:
        incident_id = notification_msg.get('incident_id')
        notification_type = notification_msg.get('type')
        
        with self.db.cursor() as cursor:
            cursor.execute("""
                SELECT EXISTS(
                    SELECT 1 FROM notification_logs
                    WHERE incident_id = %s
                    AND notification_type = %s
                    AND channel = 'slack'
                    AND status = 'sent'
                    AND routed_at IS NOT NULL
                    AND created_at > NOW() - INTERVAL '5 minutes'
                )
            """, (incident_id, notification_type))
            
            return cursor.fetchone()[0]
    except:
        return False
```

---

### Phase 5: Testing & Monitoring (1-2 ngày)

#### Step 5.1: Unit Tests

**File:** `api/workers/notification_router_test.go`

```go
package workers

import (
    "testing"
)

func TestFilterChannels(t *testing.T) {
    router := &NotificationRouter{}
    
    prefs := &UserNotificationConfig{
        SlackEnabled: true,
        SlackUserID:  "U123",
        EmailEnabled: false,
    }
    
    requested := []string{"slack", "email"}
    filtered := router.filterChannels(requested, prefs, "high")
    
    if len(filtered) != 1 || filtered[0] != "slack" {
        t.Errorf("Expected [slack], got %v", filtered)
    }
}

func TestApplyQuietHours(t *testing.T) {
    // TODO: Implement test
}
```

#### Step 5.2: Integration Test Script

**File:** `test_notification_routing.sh`

```bash
#!/bin/bash

echo "🧪 Testing Notification Routing"

# Test 1: Send notification with multiple channels
echo "Test 1: Multi-channel notification"
curl -X POST http://localhost:8080/api/test/notification \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user-uuid",
    "incident_id": "test-incident-uuid",
    "type": "assigned",
    "channels": ["slack", "email"],
    "priority": "high"
  }'

# Wait and check logs
sleep 5

# Test 2: Check notification_logs
psql -d slar_dev -c "
SELECT 
    notification_type, channel, status, priority
FROM notification_logs 
WHERE incident_id = 'test-incident-uuid'
ORDER BY created_at DESC
LIMIT 10;
"

# Test 3: Verify user preferences
psql -d slar_dev -c "
SELECT 
    slack_enabled, email_enabled,
    high_priority_channels
FROM user_notification_configs
WHERE user_id = 'test-user-uuid';
"

echo "✅ Tests completed"
```

#### Step 5.3: Monitoring Queries

```sql
-- Monitor routing performance
SELECT 
    notification_type,
    channel,
    status,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (sent_at - created_at))) as avg_latency_seconds
FROM notification_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY notification_type, channel, status
ORDER BY notification_type, channel;

-- Check failed deliveries
SELECT 
    user_id,
    channel,
    error_message,
    retry_count,
    created_at
FROM notification_logs
WHERE status = 'failed'
AND created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 20;

-- Monitor router health
SELECT 
    date_trunc('minute', routed_at) as minute,
    COUNT(*) as messages_routed,
    COUNT(DISTINCT notification_id) as unique_notifications
FROM notification_logs
WHERE routed_at > NOW() - INTERVAL '1 hour'
GROUP BY minute
ORDER BY minute DESC;
```

---

### Phase 6: Email Worker Implementation (2-3 ngày) - Optional for Phase 1

**File:** `api/workers/email_worker.go`

```go
package workers

import (
    "database/sql"
    "log"
    "time"
    "net/smtp"
)

type EmailWorker struct {
    PG           *sql.DB
    SMTPHost     string
    SMTPPort     string
    SMTPUser     string
    SMTPPassword string
    FromEmail    string
    PollInterval time.Duration
}

func NewEmailWorker(pg *sql.DB) *EmailWorker {
    return &EmailWorker{
        PG:           pg,
        SMTPHost:     getEnv("SMTP_HOST", "smtp.gmail.com"),
        SMTPPort:     getEnv("SMTP_PORT", "587"),
        SMTPUser:     getEnv("SMTP_USER", ""),
        SMTPPassword: getEnv("SMTP_PASSWORD", ""),
        FromEmail:    getEnv("FROM_EMAIL", "noreply@example.com"),
        PollInterval: 5 * time.Second,
    }
}

func (w *EmailWorker) Start() {
    log.Println("📧 Email Worker started")
    
    ticker := time.NewTicker(w.PollInterval)
    defer ticker.Stop()
    
    for range ticker.C {
        w.processEmailQueue()
    }
}

func (w *EmailWorker) processEmailQueue() {
    // TODO: Implement email processing
    // 1. Query notification_logs WHERE channel='email' AND status='pending'
    // 2. Render email template
    // 3. Send via SMTP
    // 4. Update status
}
```

---

## 📈 Rollout Strategy

### Stage 1: Internal Testing (1 tuần)
1. Deploy to dev environment
2. Test với 1-2 test users
3. Monitor logs & metrics
4. Fix bugs

### Stage 2: Beta Testing (1 tuần)
1. Deploy to staging
2. Enable for 10% users
3. A/B test với old system
4. Collect feedback

### Stage 3: Production Rollout (1 tuần)
1. Deploy router worker
2. Keep both old and new systems running
3. Gradual rollout: 10% → 25% → 50% → 100%
4. Monitor closely

### Stage 4: Deprecate Old System
1. Verify new system stable
2. Remove old routing code
3. Clean up

---

## 🔍 Monitoring & Alerting

### Key Metrics

```sql
-- Create monitoring views
CREATE VIEW notification_health_metrics AS
SELECT 
    date_trunc('hour', created_at) as hour,
    channel,
    status,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (sent_at - created_at))) as avg_latency,
    MAX(EXTRACT(EPOCH FROM (sent_at - created_at))) as max_latency
FROM notification_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour, channel, status;
```

### Alerts

```yaml
# Prometheus alerts
- alert: NotificationDeliveryFailed
  expr: rate(notification_logs{status="failed"}[5m]) > 0.1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High notification failure rate"

- alert: NotificationLatencyHigh
  expr: histogram_quantile(0.95, notification_latency_seconds) > 30
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "95th percentile latency > 30s"
```

---

## 📚 API Documentation

### User Preferences API

```http
### Get user notification preferences
GET /api/users/:userId/notification-preferences
Authorization: Bearer <token>

### Response
{
  "slack_enabled": true,
  "slack_user_id": "U123456",
  "email_enabled": true,
  "email_address": "user@example.com",
  "high_priority_channels": ["slack", "email"],
  "medium_priority_channels": ["slack"],
  "low_priority_channels": ["email"],
  "quiet_hours": {
    "enabled": true,
    "start": "22:00",
    "end": "08:00",
    "timezone": "Asia/Ho_Chi_Minh"
  }
}

### Update preferences
PUT /api/users/:userId/notification-preferences
Authorization: Bearer <token>
Content-Type: application/json

{
  "email_enabled": true,
  "high_priority_channels": ["slack", "email", "teams"]
}
```

---

## ✅ Checklist

### Phase 1: Database
- [ ] Create migration file
- [ ] Run migration on dev
- [ ] Verify schema changes
- [ ] Test rollback script
- [ ] Run migration on staging
- [ ] Run migration on prod

### Phase 2: Application Updates
- [ ] Update NotificationSender interface
- [ ] Add helper functions
- [ ] Update all Send*Notification calls
- [ ] Test on dev

### Phase 3: Router Worker
- [ ] Implement NotificationRouter struct
- [ ] Implement filtering logic
- [ ] Implement routing logic
- [ ] Add logging
- [ ] Write unit tests
- [ ] Integration test
- [ ] Deploy to dev
- [ ] Monitor logs

### Phase 4: Slack Worker Updates
- [ ] Add router detection
- [ ] Test compatibility
- [ ] Deploy

### Phase 5: Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] Load testing
- [ ] User acceptance testing

### Phase 6: Production
- [ ] Deploy router worker
- [ ] Enable for 10% users
- [ ] Monitor for 24h
- [ ] Gradual rollout
- [ ] Full rollout
- [ ] Monitor for 1 week

---

## 🆘 Troubleshooting

### Issue: Router not processing messages

```bash
# Check router worker is running
ps aux | grep notification_router

# Check queue has messages
psql -d slar_dev -c "SELECT COUNT(*) FROM pgmq.q_incident_notifications;"

# Check router logs
tail -f /var/log/slar/notification_router.log
```

### Issue: Notifications not delivered

```sql
-- Check notification_logs
SELECT * FROM notification_logs 
WHERE status = 'failed' 
ORDER BY created_at DESC 
LIMIT 10;

-- Check user preferences
SELECT * FROM user_notification_configs 
WHERE user_id = '<user-id>';
```

### Issue: High latency

```sql
-- Check slow queries
SELECT 
    channel,
    AVG(EXTRACT(EPOCH FROM (sent_at - created_at))) as avg_latency
FROM notification_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY channel;
```

---

## 📞 Support & Contact

- **Documentation:** [Link to internal docs]
- **Slack Channel:** #notifications-team
- **On-call:** [PagerDuty rotation]

---

## 📝 Changelog

### Version 1.0 (Current)
- Initial hybrid routing implementation
- Support for Slack, Email, Teams
- Priority-based routing
- Quiet hours support
- User preferences

### Version 1.1 (Planned)
- Email digest mode
- Advanced DND scheduling
- Discord integration
- Webhook notifications
- Rate limiting per channel

---

**Last Updated:** 2024-XX-XX
**Maintained by:** Engineering Team



