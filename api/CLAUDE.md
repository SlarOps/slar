## Always use ReBAC don't try implement your own
## Don't try implement your thinking, always use ReBAC for all of component design
## Don't use RBAC or any other authorization system
## If don't know what to do, always use ReBAC or ask me


SYSTEM INSTRUCTION: ReBAC Architecture & Mindset (Option A)

Bạn là một chuyên gia Software Architect nắm rõ hệ thống phân quyền ReBAC (Relationship-Based Access Control) theo kiến trúc "Option A". Dưới đây là quy tắc cốt lõi (Ground Truth) mà bạn phải tuân thủ tuyệt đối khi viết code hoặc giải thích hệ thống.

1. TƯ DUY CỐT LÕI (THE MINDSET)

Single Source of Truth: Chỉ có MỘT bảng duy nhất để lưu trữ quan hệ thành viên là memberships.

No Ghost Tables: Tuyệt đối KHÔNG tồn tại các bảng riêng lẻ như project_members, group_members, team_members. Nếu bạn định viết JOIN vào các bảng này -> DỪNG LẠI NGAY.

Zanzibar-lite Model: Hệ thống dựa trên bộ ba:

Subject: user_id

Relation: role (owner, admin, member...)

Object: resource_type + resource_id

Context-Aware: Mọi truy vấn dữ liệu đều phải nằm trong ngữ cảnh của Organization (Tenant Isolation) và Project (nếu có).

2. SCHEMA CHUẨN (SOURCE OF TRUTH)

Khi viết SQL Query, chỉ sử dụng cấu trúc này cho phân quyền:

```sql
CREATE TABLE memberships (
    user_id       UUID NOT NULL,
    resource_type TEXT NOT NULL, -- Giá trị: 'org', 'project', 'group'
    resource_id   UUID NOT NULL,
    role          TEXT NOT NULL,
    -- Composite Key đảm bảo tính duy nhất
    PRIMARY KEY (user_id, resource_type, resource_id)
);
```

Bản đồ Resource Type:

org: Thành viên cấp tổ chức.

project: Thành viên cấp dự án.

group: Thành viên đội trực (On-Call Team).

3. LOGIC TRUY VẤN & CODE (IMPLEMENTATION RULES)

3.1. Kiểm tra quyền (Authorization Check)

Khi kiểm tra quyền truy cập một tài nguyên, áp dụng logic "Explicit OR Inherited":

Trực tiếp: User có dòng record trong memberships với resource_id đó không?

Kế thừa (Chỉ cho Project): User có phải là member của Org cha VÀ Project đó đang "Open" (không có member riêng) không?

3.2. Lọc dữ liệu (Data Filtering) - COMPUTED SCOPE

Khi viết hàm List (ví dụ ListIncidents, ListGroups), phải áp dụng Hybrid Filter:

**Bước 1 (MANDATORY):** Validate org_id - return 400 nếu thiếu
**Bước 2 (Computed Scope):** Nếu KHÔNG có project_id filter:
- Trả về tài nguyên org-level (project_id IS NULL)
- PLUS tài nguyên từ projects user có quyền truy cập

**Bước 3 (Query):**
```sql
WHERE
    -- TENANT ISOLATION (MANDATORY)
    r.organization_id = $current_org_id
    AND (
        -- Computed Scope khi không có project_id filter
        r.project_id IS NULL
        OR r.project_id IN (
            SELECT resource_id FROM memberships
            WHERE user_id = $current_user_id
            AND resource_type = 'project'
        )
    )
```

**Bước 4 (Specific Project):** Nếu CÓ project_id filter → strict filtering:
```sql
WHERE r.organization_id = $current_org_id AND r.project_id = $project_id
```

3.3. Xử lý Group & On-Call

Khi cần lấy danh sách thành viên của một Group: Query bảng memberships với resource_type = 'group'.

Phân biệt rõ:

Membership: Ai thuộc nhóm? -> Dùng bảng memberships.

Rotation/Schedule: Ai đang trực? -> Dùng bảng rotations/schedule_layers (tham chiếu user_id trực tiếp).

4. CÁC LỖI THƯỜNG GẶP (HALLUCINATIONS TO AVOID)

❌ Sai: SELECT * FROM group_members WHERE group_id = ...

✅ Đúng: SELECT * FROM memberships WHERE resource_type = 'group' AND resource_id = ...

❌ Sai: JOIN projects p ON p.id = m.project_id (Bảng memberships không có cột project_id)

✅ Đúng: JOIN projects p ON p.id = m.resource_id AND m.resource_type = 'project'

❌ Sai: Quên filter organization_id khi query incidents.

✅ Đúng: Luôn thêm AND organization_id = ... để đảm bảo bảo mật đa người dùng (Multi-tenancy).

❌ Sai: Trả về tất cả data khi không có project_id

✅ Đúng: Áp dụng Computed Scope - chỉ trả về org-level + accessible projects

---

## 5. IMPLEMENTATION REFERENCE: Groups Component (COMPLETED ✅)

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

## 6. CHECKLIST CHO COMPONENT MỚI

Khi implement ReBAC cho component mới (Services, Incidents, Schedules, etc.), follow checklist:

### Backend Handler:
- [ ] Import `authz` package
- [ ] Call `authz.GetReBACFilters(c)` đầu handler
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
| Groups | ✅ | ✅ | ✅ | DONE |
| Incidents | ✅ | ✅ | ✅ | DONE |
| Services | ✅ | ✅ | ✅ | DONE |
| Schedules | ✅ | ✅ | ✅ | DONE |
| Escalation Policies | ✅ | ✅ | ✅ | DONE |
| Integrations | ✅ | ✅ | ✅ | DONE |
