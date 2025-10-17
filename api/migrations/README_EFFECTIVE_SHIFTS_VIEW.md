# Effective Shifts View - Documentation

## Overview

The `effective_shifts` view is a **centralized SQL VIEW** that automatically handles schedule override logic. Instead of duplicating complex JOIN queries throughout the codebase, all queries should use this view.

## Why Use This View?

### ❌ Before (Duplicate Logic Everywhere)
```go
// In incident.go
query := `
    SELECT COALESCE(so.new_user_id, s.user_id) as effective_user_id
    FROM shifts s
    LEFT JOIN schedule_overrides so ON s.id = so.original_schedule_id 
        AND so.is_active = true
        AND CURRENT_TIMESTAMP BETWEEN so.override_start_time AND so.override_end_time
    WHERE ...
`

// In worker.go (SAME LOGIC DUPLICATED)
query := `
    SELECT COALESCE(so.new_user_id, s.user_id) as effective_user_id
    FROM shifts s
    LEFT JOIN schedule_overrides so ON s.id = so.original_schedule_id 
        AND so.is_active = true
        AND CURRENT_TIMESTAMP BETWEEN so.override_start_time AND so.override_end_time
    WHERE ...
`

// In oncall.go (SAME LOGIC DUPLICATED AGAIN)
// ... and so on
```

### ✅ After (Centralized in VIEW)
```go
// In incident.go
query := `SELECT effective_user_id FROM effective_shifts WHERE scheduler_id = $1 AND ...`

// In worker.go
query := `SELECT effective_user_id FROM effective_shifts WHERE group_id = $1 AND ...`

// In oncall.go
query := `SELECT effective_user_id FROM effective_shifts WHERE ...`
```

## Key Benefits

1. **Single Source of Truth**: Override logic defined once in the VIEW
2. **Maintainability**: Update logic in one place, affects all queries
3. **Consistency**: All code uses same override rules
4. **Simplicity**: Cleaner, shorter queries
5. **Performance**: Database can optimize VIEW execution

## Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `effective_user_id` | UUID | **USE THIS for assignments** - The actual on-call user (with overrides) |
| `original_user_id` | UUID | The originally scheduled user |
| `is_overridden` | BOOLEAN | TRUE if this shift has an active override |
| `user_name` | VARCHAR | Effective user's name (use for display) |
| `user_email` | VARCHAR | Effective user's email (use for notifications) |
| `override_user_name` | VARCHAR | Override user's name (NULL if no override) |
| `original_user_name` | VARCHAR | Original user's name (for audit/display) |

## Common Query Patterns

### 1. Get Current On-Call User for Scheduler
```sql
SELECT effective_user_id 
FROM effective_shifts
WHERE scheduler_id = $1
AND start_time <= NOW()
AND end_time >= NOW()
ORDER BY start_time ASC
LIMIT 1;
```

### 2. Get Current On-Call User for Group
```sql
SELECT effective_user_id 
FROM effective_shifts
WHERE group_id = $1
AND start_time <= NOW()
AND end_time >= NOW()
ORDER BY start_time ASC
LIMIT 1;
```

### 3. Get All Shifts with Overrides
```sql
SELECT 
    shift_id,
    original_user_name,
    user_name as effective_user_name,
    override_reason,
    start_time,
    end_time
FROM effective_shifts
WHERE is_overridden = true
AND group_id = $1
ORDER BY start_time DESC;
```

### 4. Get Upcoming On-Call Schedule
```sql
SELECT 
    effective_user_id,
    user_name,
    start_time,
    end_time,
    is_overridden
FROM effective_shifts
WHERE scheduler_id = $1
AND start_time >= NOW()
ORDER BY start_time ASC
LIMIT 10;
```

## Usage in Go Code

### Example: Incident Assignment
```go
func (s *IncidentService) getCurrentOnCallUserFromScheduler(schedulerID, groupID string) (string, error) {
    query := `
        SELECT effective_user_id
        FROM effective_shifts
        WHERE scheduler_id = $1
        AND group_id = $2
        AND start_time <= NOW()
        AND end_time >= NOW()
        ORDER BY start_time ASC
        LIMIT 1
    `
    
    var userID string
    err := s.PG.QueryRow(query, schedulerID, groupID).Scan(&userID)
    if err != nil {
        if err == sql.ErrNoRows {
            return "", nil // No one on-call
        }
        return "", fmt.Errorf("failed to get current on-call user: %w", err)
    }
    
    return userID, nil
}
```

## Override Logic

The view automatically handles:

1. **Active Overrides**: Only includes overrides where `is_active = true`
2. **Time-Based**: Only applies overrides within their time window
3. **User Resolution**: Automatically returns the effective (override) user
4. **Original Tracking**: Preserves original user info for audit trails

### How It Works

```
Original Shift: A scheduled from 9am-5pm
Override: A → B from 9am-5pm

Query at 10am:
  effective_user_id = B  (override user)
  original_user_id = A   (original scheduled user)
  is_overridden = true
  user_name = "Bob"      (effective user's name)
  original_user_name = "Alice"

Result: Incident assigned to B ✅
```

## Migration

To create the view:
```bash
psql -d your_database -f create_effective_shifts_view.sql
```

## Important Notes

⚠️ **Always use `effective_user_id` for:**
- Incident assignment
- Alert routing
- Notification targeting
- Escalation

⚠️ **Use `original_user_id` only for:**
- Audit trails
- Override history
- Display purposes ("A → B")

## Related Files

- `create_effective_shifts_view.sql` - VIEW definition
- `services/incident.go` - Uses VIEW for incident assignment
- `workers/worker.go` - Uses VIEW for escalation
- `services/oncall.go` - Uses VIEW for on-call queries

## Testing

```sql
-- Create test shift
INSERT INTO shifts (id, scheduler_id, group_id, user_id, start_time, end_time, ...) 
VALUES ('shift-1', 'sched-1', 'group-1', 'user-a', NOW(), NOW() + INTERVAL '8 hours', ...);

-- Create override
INSERT INTO schedule_overrides (id, original_schedule_id, new_user_id, override_start_time, override_end_time, is_active)
VALUES ('override-1', 'shift-1', 'user-b', NOW(), NOW() + INTERVAL '8 hours', true);

-- Query view
SELECT effective_user_id, original_user_id, is_overridden FROM effective_shifts WHERE shift_id = 'shift-1';

-- Expected result:
-- effective_user_id: user-b
-- original_user_id: user-a  
-- is_overridden: true
```

## Performance

The view is **read-only** and uses LEFT JOINs for optimal performance. Database query planner can optimize VIEW queries just like regular queries.

For best performance:
- Add indexes on `start_time`, `end_time`, `scheduler_id`, `group_id`
- Use specific WHERE clauses (don't SELECT * from entire view)
- Limit results when possible

## Future Improvements

- [ ] Add materialized view option for high-traffic scenarios
- [ ] Add view for historical overrides
- [ ] Add computed field for "time remaining in shift"
- [ ] Add support for partial overrides (override only part of shift)

