1. THE MINDSET (CORE PRINCIPLES)

Single Source of Truth: There is only ONE table for storing membership relationships: `memberships`.

No Ghost Tables: There are absolutely NO separate tables like `project_members`, `group_members`, `team_members`. If you intend to JOIN these tables -> STOP IMMEDIATELY.

Zanzibar-lite Model: The system is based on the triplet:

Subject: user_id

Relation: role (owner, admin, member...)

Object: resource_type + resource_id

Context-Aware: All data queries must be within the context of Organization (Tenant Isolation) and Project (if applicable).

2. STANDARD SCHEMA (SOURCE OF TRUTH)

When writing SQL queries, use only this structure for authorization:

```sql
CREATE TABLE memberships (
    user_id       UUID NOT NULL,
    resource_type TEXT NOT NULL, -- Values: 'org', 'project', 'group'
    resource_id   UUID NOT NULL,
    role          TEXT NOT NULL,
    -- Composite Key ensures uniqueness
    PRIMARY KEY (user_id, resource_type, resource_id)
);
```

Resource Type Map:

org: Organization-level membership.

project: Project-level membership.

group: On-Call Team membership.

3. QUERY LOGIC & CODE (IMPLEMENTATION RULES)

3.1. Authorization Check

When checking access to a resource, apply "Explicit OR Inherited" logic:

Direct: Does the user have a record in memberships with that resource_id?

Inherited (Only for Project): Is the user a member of the parent Org AND is that Project "Open" (has no dedicated members)?

3.2. Data Filtering - COMPUTED SCOPE

When writing List functions (e.g., ListIncidents, ListGroups), apply Hybrid Filter:

**Step 1 (MANDATORY):** Validate org_id - return 400 if missing
**Step 2 (Computed Scope):** If NO project_id filter:
- Return org-level resources (project_id IS NULL)
- PLUS resources from projects the user has access to

**Step 3 (Query):**
```sql
WHERE
    -- TENANT ISOLATION (MANDATORY)
    r.organization_id = $current_org_id
    AND (
        -- Computed Scope when no project_id filter
        r.project_id IS NULL
        OR r.project_id IN (
            SELECT resource_id FROM memberships
            WHERE user_id = $current_user_id
            AND resource_type = 'project'
        )
    )
```

**Step 4 (Specific Project):** If project_id filter EXISTS -> strict filtering:
```sql
WHERE r.organization_id = $current_org_id AND r.project_id = $project_id
```

3.3. Group & On-Call Handling

When retrieving group members: Query the memberships table with resource_type = 'group'.

Clear distinction:

Membership: Who belongs to the group? -> Use memberships table.

Rotation/Schedule: Who is currently on-call? -> Use rotations/schedule_layers tables (referencing user_id directly).

4. COMMON MISTAKES (HALLUCINATIONS TO AVOID)

WRONG: SELECT * FROM group_members WHERE group_id = ...

CORRECT: SELECT * FROM memberships WHERE resource_type = 'group' AND resource_id = ...

WRONG: JOIN projects p ON p.id = m.project_id (memberships table has no project_id column)

CORRECT: JOIN projects p ON p.id = m.resource_id AND m.resource_type = 'project'

WRONG: Forgetting to filter organization_id when querying incidents.

CORRECT: Always add AND organization_id = ... to ensure multi-tenant security.

WRONG: Returning all data when no project_id is provided

CORRECT: Apply Computed Scope - return only org-level + accessible projects

---

## 5. IMPLEMENTATION REFERENCE: Groups Component (COMPLETED)

### 5.1. Handler Pattern (`handlers/group.go`)

```go
func (h *GroupHandler) ListGroups(c *gin.Context) {
    // Step 1: Get ReBAC filters from context
    filters := authz.GetReBACFilters(c)

    // Step 2: MANDATORY - Validate org_id (Tenant Isolation)
    if filters["current_org_id"] == nil || filters["current_org_id"].(string) == "" {
        c.JSON(http.StatusBadRequest, gin.H{
            "error":   "organization_id is required",
            "message": "Please provide org_id query param or X-Org-ID header for tenant isolation",
        })
        return
    }

    // Step 3: OPTIONAL - Extract project_id from query or header
    if projectID := c.Query("project_id"); projectID != "" {
        filters["project_id"] = projectID
    } else if projectID := c.GetHeader("X-Project-ID"); projectID != "" {
        filters["project_id"] = projectID
    }

    // Step 4: Add resource-specific filters (type, search, active_only)
    if groupType := c.Query("type"); groupType != "" {
        filters["type"] = groupType
    }

    // Step 5: Call service with filters
    groups, err := h.GroupService.ListGroups(filters)
    // ...
}
```

### 5.2. Service Pattern (`services/group.go`)

```go
func (s *GroupService) ListGroups(filters map[string]interface{}) ([]db.Group, error) {
    // Extract context
    currentUserID := filters["current_user_id"].(string)
    currentOrgID := filters["current_org_id"].(string)

    // Base query with TENANT ISOLATION
    query := `
        SELECT g.* FROM groups g
        WHERE g.organization_id = $2  -- MANDATORY
        AND (
            -- ReBAC access check: Direct OR Inherited
            EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $1 AND m.resource_type = 'group' AND m.resource_id = g.id)
            OR (g.visibility = 'organization' AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $1 AND m.resource_type = 'org' AND m.resource_id = $2))
        )
    `
    args := []interface{}{currentUserID, currentOrgID}
    argIndex := 3

    // PROJECT FILTER - Computed Scope
    if projectID, ok := filters["project_id"].(string); ok && projectID != "" {
        // Specific project - strict filter
        query += fmt.Sprintf(" AND g.project_id = $%d", argIndex)
        args = append(args, projectID)
        argIndex++
    } else {
        // No project_id → Computed Scope
        query += fmt.Sprintf(`
            AND (
                g.project_id IS NULL
                OR g.project_id IN (
                    SELECT m.resource_id FROM memberships m
                    WHERE m.user_id = $%d AND m.resource_type = 'project'
                )
            )
        `, argIndex)
        args = append(args, currentUserID)
        argIndex++
    }

    // Execute query...
}
```

### 5.3. Frontend Pattern (`lib/api.js`)

```javascript
// All group API methods must support org_id (required) and project_id (optional)
async getGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.org_id) params.append('org_id', filters.org_id);       // MANDATORY
    if (filters.project_id) params.append('project_id', filters.project_id); // OPTIONAL
    // ... other filters
    return this.request(`/groups${params.toString() ? `?${params}` : ''}`);
}
```

### 5.4. React Component Pattern (`components/groups/GroupsList.js`)

```javascript
export default function GroupsList({ filters, ... }) {
    const { currentOrg, currentProject } = useOrg();  // Get context

    useEffect(() => {
        const filtersWithContext = {
            ...filters,
            org_id: currentOrg.id,                                    // MANDATORY
            ...(currentProject?.id && { project_id: currentProject.id }) // OPTIONAL
        };

        const data = await apiClient.getGroups(filtersWithContext);
        // ...
    }, [filters, currentOrg?.id, currentProject?.id]);  // Re-fetch when project changes
}
```

### 5.5. API Endpoints Summary

| Endpoint | org_id | project_id | Behavior |
|----------|--------|------------|----------|
| GET /groups | REQUIRED | OPTIONAL | User-scoped groups with Computed Scope |
| GET /groups/my | REQUIRED | OPTIONAL | Only groups user is direct member of |
| GET /groups/public | REQUIRED | OPTIONAL | Public/organization visibility groups |
| GET /groups/all | REQUIRED | OPTIONAL | Admin: all groups in scope |

---

## 6. CHECKLIST FOR NEW COMPONENTS

When implementing ReBAC for new components (Services, Incidents, Schedules, etc.), follow this checklist:

### Backend Handler:
- [ ] Import `authz` package
- [ ] Call `authz.GetReBACFilters(c)` at the beginning of handler
- [ ] Validate `current_org_id` - return 400 if missing
- [ ] Extract `project_id` from query/header (optional)
- [ ] Pass filters to service layer

### Backend Service:
- [ ] Extract `current_user_id`, `current_org_id` from filters
- [ ] Add `WHERE organization_id = $org_id` (MANDATORY)
- [ ] Implement Computed Scope for project filtering
- [ ] Use `memberships` table for access checks (NOT ghost tables)

### Frontend API Client:
- [ ] Add `org_id` param to all methods (required)
- [ ] Add `project_id` param (optional)
- [ ] Update JSDoc comments

### Frontend Components:
- [ ] Import `useOrg()` hook
- [ ] Pass `currentOrg.id` to API calls
- [ ] Pass `currentProject?.id` to API calls (if applicable)
- [ ] Add `currentProject?.id` to useEffect dependencies

---

## Database Connection

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable
```

---

## Components Implementation Status

| Component | ReBAC Handler | Computed Scope | Frontend Integration | Status |
|-----------|---------------|----------------|----------------------|--------|
| Groups | Yes | Yes | Yes | DONE |
| Incidents | Yes | Yes | Yes | DONE |
| Services | Yes | Yes | Yes | DONE |
| Schedules | Yes | Yes | Yes | DONE |
| Escalation Policies | Yes | Yes | Yes | DONE |
| Integrations | Yes | Yes | Yes | DONE |
