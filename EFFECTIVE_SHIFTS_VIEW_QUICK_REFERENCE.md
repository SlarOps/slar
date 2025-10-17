# Effective Shifts VIEW - Quick Reference

## One-Liner
**SQL VIEW that automatically handles schedule override logic - use this instead of writing JOIN queries.**

---

## Quick Examples

### ✅ Get Current On-Call User
```go
// For specific scheduler
query := `
    SELECT effective_user_id FROM effective_shifts
    WHERE scheduler_id = $1 
    AND start_time <= NOW() AND end_time >= NOW()
    LIMIT 1
`

// For entire group
query := `
    SELECT effective_user_id FROM effective_shifts
    WHERE group_id = $1 
    AND start_time <= NOW() AND end_time >= NOW()
    LIMIT 1
`
```

### ✅ Get Shift Details with Override Info
```go
query := `
    SELECT 
        effective_user_id,    -- Use this for assignment
        user_name,             -- Effective user name
        user_email,            -- Effective user email
        is_overridden,         -- TRUE if overridden
        original_user_name,    -- Original scheduled user
        override_reason        -- Why overridden
    FROM effective_shifts
    WHERE shift_id = $1
`
```

### ✅ Get All Overridden Shifts
```go
query := `
    SELECT * FROM effective_shifts
    WHERE group_id = $1 AND is_overridden = true
    ORDER BY start_time DESC
`
```

---

## Key Fields Cheatsheet

| Field | Use For | Notes |
|-------|---------|-------|
| `effective_user_id` | **Assignment, Routing** | ⭐ Use this for "who is on-call" |
| `user_name` | Display, Notifications | Effective user's name |
| `user_email` | Notifications | Effective user's email |
| `original_user_id` | Audit, Display | Originally scheduled user |
| `original_user_name` | Display "A→B" | Only set if overridden |
| `is_overridden` | Conditional Logic | TRUE if override active |
| `override_reason` | Display, Audit | Why overridden |
| `scheduler_name` | Filtering, Display | Which scheduler |
| `start_time` / `end_time` | Time filtering | Shift times |

---

## Decision Tree

```
Need to query shifts?
│
├─ Need override logic? → ✅ Use effective_shifts VIEW
│  Example: Get current on-call user
│
└─ Raw shift data only? → Use shifts table directly
   Example: Create/update shift (no override needed)
```

---

## Common Patterns

### Pattern 1: Current On-Call Assignment
```go
func getCurrentOnCallUser(schedulerID string) (string, error) {
    query := `SELECT effective_user_id FROM effective_shifts 
              WHERE scheduler_id = $1 AND start_time <= NOW() AND end_time >= NOW() 
              LIMIT 1`
    var userID string
    err := db.QueryRow(query, schedulerID).Scan(&userID)
    return userID, err
}
```

### Pattern 2: Display Shift with Override Info
```go
type ShiftDisplay struct {
    EffectiveUser string
    OriginalUser  string
    IsOverridden  bool
    Reason        string
}

query := `SELECT user_name, original_user_name, is_overridden, override_reason 
          FROM effective_shifts WHERE shift_id = $1`
```

### Pattern 3: List All Shifts in Timeline
```go
query := `SELECT shift_id, effective_user_id, user_name, start_time, end_time, is_overridden
          FROM effective_shifts 
          WHERE group_id = $1 
          ORDER BY scheduler_name, start_time`
```

---

## Important Rules

### ✅ DO
- Use `effective_user_id` for all assignment logic
- Use VIEW for queries that need to respect overrides
- Filter by time: `start_time <= NOW() AND end_time >= NOW()`

### ❌ DON'T
- Don't write `LEFT JOIN schedule_overrides` manually
- Don't use `shifts.user_id` for assignment (use `effective_user_id`)
- Don't duplicate override logic in application code

---

## Visual: How It Works

```
Database Tables:
┌──────────┐       ┌────────────────────┐
│  shifts  │       │ schedule_overrides │
│          │       │                    │
│ A: 9-5pm │◄──────┤ A→B: 9-5pm        │
└──────────┘       └────────────────────┘
      │                    │
      └────────┬───────────┘
               ▼
    ┌─────────────────────┐
    │ effective_shifts    │
    │ (VIEW)              │
    │                     │
    │ effective_user: B   │
    │ original_user: A    │
    │ is_overridden: true │
    └─────────────────────┘
               │
               ▼
        Your Application
        (Uses B for assignment) ✅
```

---

## Files to Reference

1. **VIEW Definition**: `api/migrations/create_effective_shifts_view.sql`
2. **Full Documentation**: `api/migrations/README_EFFECTIVE_SHIFTS_VIEW.md`
3. **Refactoring Summary**: `OVERRIDE_VIEW_REFACTORING.md`
4. **Example Usage**: 
   - `api/services/incident.go` (lines ~987, ~1020)
   - `api/workers/worker.go` (lines ~460, ~502)

---

## Testing

```sql
-- Quick test
SELECT effective_user_id, original_user_id, is_overridden 
FROM effective_shifts 
WHERE group_id = 'your-group-id' 
AND start_time <= NOW() 
AND end_time >= NOW();
```

Expected:
- `effective_user_id` = override user (if overridden) or original user
- `is_overridden` = TRUE if override exists, FALSE otherwise

---

## Questions?

**Q: When should I NOT use the VIEW?**
A: When creating/updating shifts (use `shifts` table directly). VIEW is read-only.

**Q: Does VIEW affect performance?**
A: No. It's just a query shortcut. Database optimizes it like normal queries.

**Q: What if I need custom override logic?**
A: Update the VIEW definition once, affects all queries automatically.

**Q: Can I add more fields to VIEW?**
A: Yes! Edit `create_effective_shifts_view.sql` and recreate VIEW.

---

## Summary

```
🎯 Goal: Simplify override logic
📦 Solution: SQL VIEW (effective_shifts)
✅ Usage: SELECT * FROM effective_shifts WHERE ...
⭐ Key Field: effective_user_id (use for assignment)
```

**Remember: Use `effective_shifts` view for all queries that need override logic! 🚀**

