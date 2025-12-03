package services

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type GroupService struct {
	PG *sql.DB
}

func NewGroupService(pg *sql.DB) *GroupService {
	return &GroupService{PG: pg}
}

// GROUP CRUD OPERATIONS

// ListGroups returns groups with ReBAC filtering
// ReBAC: Explicit OR Inherited access pattern with MANDATORY Tenant Isolation
// - Direct: User is a member of the group
// - Inherited: User is org member AND group visibility is 'organization' or 'public'
// IMPORTANT: All queries MUST be scoped to current organization (Context-Aware)
func (s *GroupService) ListGroups(filters map[string]interface{}) ([]db.Group, error) {
	// ReBAC: Get user context
	currentUserID, hasCurrentUser := filters["current_user_id"].(string)
	if !hasCurrentUser || currentUserID == "" {
		return []db.Group{}, nil
	}

	// ReBAC: Get organization context (MANDATORY for Tenant Isolation)
	currentOrgID, hasOrgContext := filters["current_org_id"].(string)
	if !hasOrgContext || currentOrgID == "" {
		// Log warning but return empty for safety
		fmt.Printf("WARNING: ListGroups called without organization context - returning empty\n")
		return []db.Group{}, nil
	}

	// Check for special filter modes
	myGroupsOnly, _ := filters["my_groups_only"].(bool)
	publicOnly, _ := filters["public_only"].(bool)

	// ReBAC: Explicit OR Inherited access with Tenant Isolation
	// Uses single `memberships` table with resource_type = 'group' or 'org'
	// $1 = currentUserID, $2 = currentOrgID
	var query string
	if myGroupsOnly {
		// "My Groups" - only groups user is a direct member of
		query = `
			SELECT g.id, g.name, g.description, g.type, g.visibility, g.is_active, g.created_at, g.updated_at,
			       COALESCE(u.name, 'Unknown') as created_by,
			       g.escalation_timeout, g.escalation_method,
			       COALESCE(mc.member_count, 0) as member_count
			FROM groups g
			LEFT JOIN users u ON g.created_by = u.id
			LEFT JOIN (
				SELECT resource_id, COUNT(*) as member_count
				FROM memberships
				WHERE resource_type = 'group'
				GROUP BY resource_id
			) mc ON g.id = mc.resource_id
			WHERE
				-- TENANT ISOLATION (MANDATORY)
				g.organization_id = $2
				-- Only groups user is a direct member of
				AND EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.user_id = $1
					AND m.resource_type = 'group'
					AND m.resource_id = g.id
				)
		`
	} else if publicOnly {
		// "Public Groups" - only public/organization visibility groups
		query = `
			SELECT g.id, g.name, g.description, g.type, g.visibility, g.is_active, g.created_at, g.updated_at,
			       COALESCE(u.name, 'Unknown') as created_by,
			       g.escalation_timeout, g.escalation_method,
			       COALESCE(mc.member_count, 0) as member_count
			FROM groups g
			LEFT JOIN users u ON g.created_by = u.id
			LEFT JOIN (
				SELECT resource_id, COUNT(*) as member_count
				FROM memberships
				WHERE resource_type = 'group'
				GROUP BY resource_id
			) mc ON g.id = mc.resource_id
			WHERE
				-- TENANT ISOLATION (MANDATORY)
				g.organization_id = $2
				-- Only public visibility groups
				AND g.visibility IN ('public', 'organization')
				-- Must be org member to see org groups
				AND EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.user_id = $1
					AND m.resource_type = 'org'
					AND m.resource_id = $2
				)
		`
	} else {
		// "All Groups" - full ReBAC access check
		query = `
			SELECT g.id, g.name, g.description, g.type, g.visibility, g.is_active, g.created_at, g.updated_at,
			       COALESCE(u.name, 'Unknown') as created_by,
			       g.escalation_timeout, g.escalation_method,
			       COALESCE(mc.member_count, 0) as member_count
			FROM groups g
			LEFT JOIN users u ON g.created_by = u.id
			LEFT JOIN (
				SELECT resource_id, COUNT(*) as member_count
				FROM memberships
				WHERE resource_type = 'group'
				GROUP BY resource_id
			) mc ON g.id = mc.resource_id
			WHERE
				-- TENANT ISOLATION (MANDATORY): Only groups in current organization
				g.organization_id = $2
				AND (
					-- Scope A: Direct group membership
					EXISTS (
						SELECT 1 FROM memberships m
						WHERE m.user_id = $1
						AND m.resource_type = 'group'
						AND m.resource_id = g.id
					)
					OR
					-- Scope B: Inherited access - org member can see 'organization' visibility groups
					(
						g.visibility = 'organization'
						AND EXISTS (
							SELECT 1 FROM memberships m
							WHERE m.user_id = $1
							AND m.resource_type = 'org'
							AND m.resource_id = $2
						)
					)
					OR
					-- Scope C: Public groups - org member can see 'public' visibility groups
					(
						g.visibility = 'public'
						AND EXISTS (
							SELECT 1 FROM memberships m
							WHERE m.user_id = $1
							AND m.resource_type = 'org'
							AND m.resource_id = $2
						)
					)
				)
		`
	}
	args := []interface{}{currentUserID, currentOrgID}
	argIndex := 3

	// Apply resource-specific filters
	if groupType, ok := filters["type"].(string); ok && groupType != "" {
		query += fmt.Sprintf(" AND g.type = $%d", argIndex)
		args = append(args, groupType)
		argIndex++
	}

	if isActive, ok := filters["active_only"].(bool); ok {
		query += fmt.Sprintf(" AND g.is_active = $%d", argIndex)
		args = append(args, isActive)
		argIndex++
	}

	if search, ok := filters["search"].(string); ok && search != "" {
		query += fmt.Sprintf(" AND (g.name ILIKE $%d OR g.description ILIKE $%d)", argIndex, argIndex+1)
		searchPattern := "%" + search + "%"
		args = append(args, searchPattern, searchPattern)
		argIndex += 2
	}

	// ReBAC: Project-level filtering with Computed Scope
	if projectID, ok := filters["project_id"].(string); ok && projectID != "" {
		// Specific project filter - strict filtering
		query += fmt.Sprintf(" AND g.project_id = $%d", argIndex)
		args = append(args, projectID)
		argIndex++
	} else {
		// No project_id provided → Computed Scope (show everything user can see):
		// 1. Org-level groups (project_id IS NULL)
		// 2. Groups from projects user has access to (via memberships)
		query += fmt.Sprintf(`
			AND (
				g.project_id IS NULL
				OR g.project_id IN (
					SELECT m.resource_id FROM memberships m
					WHERE m.user_id = $%d
					AND m.resource_type = 'project'
				)
			)
		`, argIndex)
		args = append(args, currentUserID)
		argIndex++
	}

	query += " ORDER BY g.created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []db.Group
	for rows.Next() {
		var g db.Group
		err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.Type, &g.Visibility, &g.IsActive,
			&g.CreatedAt, &g.UpdatedAt, &g.CreatedBy,
			&g.EscalationTimeout, &g.EscalationMethod, &g.MemberCount,
		)
		if err != nil {
			continue
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// ListUserScopedGroups returns groups visible to a specific user
// This includes: groups user belongs to + public groups
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) ListUserScopedGroups(userID, groupType string, isActive *bool) ([]db.Group, error) {
	query := `
		SELECT DISTINCT g.id, g.name, g.description, g.type, g.visibility, g.is_active,
		       g.created_at, g.updated_at, COALESCE(u.name, 'Unknown') as created_by,
		       g.escalation_timeout, g.escalation_method,
		       COALESCE(mc.member_count, 0) as member_count,
		       CASE WHEN m.user_id IS NOT NULL THEN true ELSE false END as is_member
		FROM groups g
		LEFT JOIN users u ON g.created_by = u.id
		LEFT JOIN (
			SELECT resource_id, COUNT(*) as member_count
			FROM memberships
			WHERE resource_type = 'group'
			GROUP BY resource_id
		) mc ON g.id = mc.resource_id
		LEFT JOIN memberships m ON g.id = m.resource_id AND m.resource_type = 'group' AND m.user_id = $1
		WHERE (g.visibility IN ('public', 'organization') OR m.user_id IS NOT NULL)
		  AND g.is_active = true
	`
	args := []interface{}{userID}

	if groupType != "" {
		query += " AND g.type = $" + fmt.Sprintf("%d", len(args)+1)
		args = append(args, groupType)
	}

	if isActive != nil && !*isActive {
		query += " AND g.is_active = $" + fmt.Sprintf("%d", len(args)+1)
		args = append(args, *isActive)
	}

	query += " ORDER BY is_member DESC, g.created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []db.Group
	for rows.Next() {
		var g db.Group
		var isMember bool
		err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.Type, &g.Visibility, &g.IsActive,
			&g.CreatedAt, &g.UpdatedAt, &g.CreatedBy,
			&g.EscalationTimeout, &g.EscalationMethod, &g.MemberCount, &isMember,
		)
		if err != nil {
			continue
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// ListPublicGroups returns only public groups that user can discover and join
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) ListPublicGroups(userID, groupType string) ([]db.Group, error) {
	query := `
		SELECT g.id, g.name, g.description, g.type, g.visibility, g.is_active,
		       g.created_at, g.updated_at, COALESCE(u.name, 'Unknown') as created_by,
		       g.escalation_timeout, g.escalation_method,
		       COALESCE(mc.member_count, 0) as member_count,
		       CASE WHEN m.user_id IS NOT NULL THEN true ELSE false END as is_member
		FROM groups g
		LEFT JOIN users u ON g.created_by = u.id
		LEFT JOIN (
			SELECT resource_id, COUNT(*) as member_count
			FROM memberships
			WHERE resource_type = 'group'
			GROUP BY resource_id
		) mc ON g.id = mc.resource_id
		LEFT JOIN memberships m ON g.id = m.resource_id AND m.resource_type = 'group' AND m.user_id = $1
		WHERE g.visibility IN ('public', 'organization')
		  AND g.is_active = true
	`
	args := []interface{}{userID}

	if groupType != "" {
		query += " AND g.type = $" + fmt.Sprintf("%d", len(args)+1)
		args = append(args, groupType)
	}

	query += " ORDER BY g.created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []db.Group
	for rows.Next() {
		var g db.Group
		var isMember bool
		err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.Type, &g.Visibility, &g.IsActive,
			&g.CreatedAt, &g.UpdatedAt, &g.CreatedBy,
			&g.EscalationTimeout, &g.EscalationMethod, &g.MemberCount, &isMember,
		)
		if err != nil {
			continue
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// GetGroup returns a specific group by ID
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) GetGroup(id string) (db.Group, error) {
	var g db.Group
	err := s.PG.QueryRow(`
		SELECT g.id, g.name, g.description, g.type, g.visibility, g.is_active, g.created_at, g.updated_at,
		       COALESCE(u.name, 'Unknown') as created_by,
		       g.escalation_timeout, g.escalation_method,
		       COALESCE(mc.member_count, 0) as member_count
		FROM groups g
		LEFT JOIN users u ON g.created_by = u.id
		LEFT JOIN (
			SELECT resource_id, COUNT(*) as member_count
			FROM memberships
			WHERE resource_type = 'group'
			GROUP BY resource_id
		) mc ON g.id = mc.resource_id
		WHERE g.id = $1
	`, id).Scan(
		&g.ID, &g.Name, &g.Description, &g.Type, &g.Visibility, &g.IsActive,
		&g.CreatedAt, &g.UpdatedAt, &g.CreatedBy,
		&g.EscalationTimeout, &g.EscalationMethod, &g.MemberCount,
	)
	return g, err
}

// GetGroupWithMembers returns a group with all its members
func (s *GroupService) GetGroupWithMembers(id string) (db.GroupWithMembers, error) {
	group, err := s.GetGroup(id)
	if err != nil {
		return db.GroupWithMembers{}, err
	}

	members, err := s.GetGroupMembers(id)
	if err != nil {
		return db.GroupWithMembers{}, err
	}

	return db.GroupWithMembers{
		Group:   group,
		Members: members,
	}, nil
}

// CreateGroup creates a new group
func (s *GroupService) CreateGroup(req db.CreateGroupRequest, createdBy string) (db.Group, error) {
	group := db.Group{
		ID:             uuid.New().String(),
		Name:           req.Name,
		Description:    req.Description,
		Type:           req.Type,
		IsActive:       true,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		CreatedBy:      createdBy,
		OrganizationID: req.OrganizationID,
		ProjectID:      req.ProjectID,
	}

	// Set visibility (default to private if not specified)
	if req.Visibility != "" {
		group.Visibility = req.Visibility
	} else {
		group.Visibility = db.GroupVisibilityPrivate
	}

	// Set default values if not provided
	if req.EscalationTimeout > 0 {
		group.EscalationTimeout = req.EscalationTimeout
	} else {
		group.EscalationTimeout = 300 // 5 minutes default
	}

	if req.EscalationMethod != "" {
		group.EscalationMethod = req.EscalationMethod
	} else {
		group.EscalationMethod = db.EscalationMethodParallel
	}

	// Start transaction to create group and add creator as member
	tx, err := s.PG.Begin()
	if err != nil {
		return group, err
	}
	defer tx.Rollback()

	// Create the group with organization_id and project_id
	_, err = tx.Exec(`
		INSERT INTO groups (id, name, description, type, visibility, is_active, created_at, updated_at, created_by, escalation_timeout, escalation_method, organization_id, project_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, group.ID, group.Name, group.Description, group.Type, group.Visibility, group.IsActive, group.CreatedAt, group.UpdatedAt, group.CreatedBy, group.EscalationTimeout, group.EscalationMethod, nullIfEmpty(group.OrganizationID), nullIfEmpty(group.ProjectID))
	if err != nil {
		return group, err
	}

	// Auto-add creator as group admin (ReBAC: uses memberships table)
	_, err = tx.Exec(`
		INSERT INTO memberships (user_id, resource_type, resource_id, role, created_at, updated_at, invited_by)
		VALUES ($1, 'group', $2, 'admin', $3, $4, $5)
	`, createdBy, group.ID, group.CreatedAt, group.UpdatedAt, createdBy)
	if err != nil {
		return group, err
	}

	// Commit transaction
	err = tx.Commit()
	return group, err
}

// nullIfEmpty returns nil if string is empty, otherwise returns the string pointer
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// UpdateGroup updates an existing group
func (s *GroupService) UpdateGroup(id string, req db.UpdateGroupRequest) (db.Group, error) {
	// Get current group
	group, err := s.GetGroup(id)
	if err != nil {
		return group, err
	}

	// Update fields if provided
	if req.Name != nil {
		group.Name = *req.Name
	}
	if req.Description != nil {
		group.Description = *req.Description
	}
	if req.Type != nil {
		group.Type = *req.Type
	}
	if req.Visibility != nil {
		group.Visibility = *req.Visibility
	}
	if req.IsActive != nil {
		group.IsActive = *req.IsActive
	}
	if req.EscalationTimeout != nil {
		group.EscalationTimeout = *req.EscalationTimeout
	}
	if req.EscalationMethod != nil {
		group.EscalationMethod = *req.EscalationMethod
	}

	group.UpdatedAt = time.Now()

	_, err = s.PG.Exec(`
		UPDATE groups 
		SET name = $2, description = $3, type = $4, visibility = $5, is_active = $6, updated_at = $7, escalation_timeout = $8, escalation_method = $9
		WHERE id = $1
	`, id, group.Name, group.Description, group.Type, group.Visibility, group.IsActive, group.UpdatedAt, group.EscalationTimeout, group.EscalationMethod)

	return group, err
}

// DeleteGroup soft deletes a group
func (s *GroupService) DeleteGroup(id string) error {
	_, err := s.PG.Exec(`UPDATE groups SET is_active = false, updated_at = $1 WHERE id = $2`, time.Now(), id)
	return err
}

// GROUP MEMBER OPERATIONS

// GetGroupMembers returns all members of a group
// ReBAC: Uses memberships table with resource_type = 'group'
// Note: escalation_order and notification_preferences belong to Scheduler tables, not memberships
func (s *GroupService) GetGroupMembers(groupID string) ([]db.GroupMember, error) {
	query := `
		SELECT
			m.id, m.resource_id as group_id, m.user_id, m.role,
			m.created_at as added_at, COALESCE(m.invited_by::text, '') as added_by,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM memberships m
		JOIN users u ON m.user_id = u.id
		WHERE m.resource_type = 'group' AND m.resource_id = $1
		ORDER BY m.created_at ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []db.GroupMember
	for rows.Next() {
		var m db.GroupMember
		err := rows.Scan(
			&m.ID, &m.GroupID, &m.UserID, &m.Role,
			&m.AddedAt, &m.AddedBy,
			&m.UserName, &m.UserEmail, &m.UserTeam,
		)
		if err != nil {
			continue
		}
		m.IsActive = true // memberships are always active (no is_active column)
		m.EscalationOrder = 0 // Escalation order belongs to Scheduler tables
		members = append(members, m)
	}
	return members, nil
}

// GetGroupMember returns a specific group member
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) GetGroupMember(groupID, userID string) (db.GroupMember, error) {
	var m db.GroupMember
	err := s.PG.QueryRow(`
		SELECT
			m.id, m.resource_id as group_id, m.user_id, m.role,
			m.created_at as added_at, COALESCE(m.invited_by::text, '') as added_by,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM memberships m
		JOIN users u ON m.user_id = u.id
		WHERE m.resource_type = 'group' AND m.resource_id = $1 AND m.user_id = $2
	`, groupID, userID).Scan(
		&m.ID, &m.GroupID, &m.UserID, &m.Role,
		&m.AddedAt, &m.AddedBy,
		&m.UserName, &m.UserEmail, &m.UserTeam,
	)

	m.IsActive = true // memberships are always active
	m.EscalationOrder = 0 // Escalation order belongs to Scheduler tables

	return m, err
}

// AddGroupMember adds a user to a group
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) AddGroupMember(groupID string, req db.AddGroupMemberRequest, addedBy string) (db.GroupMember, error) {
	now := time.Now()
	member := db.GroupMember{
		GroupID:  groupID,
		UserID:   req.UserID,
		Role:     req.Role,
		IsActive: true,
		AddedAt:  now,
		AddedBy:  addedBy,
	}

	// Set default role - map 'leader' to 'admin' for ReBAC consistency
	if member.Role == "" {
		member.Role = "member"
	} else if member.Role == db.GroupMemberRoleLeader {
		member.Role = "admin" // ReBAC uses 'admin' instead of 'leader'
	}

	// Note: escalation_order and notification_preferences belong to Scheduler tables, not memberships

	var memberID string
	err := s.PG.QueryRow(`
		INSERT INTO memberships (user_id, resource_type, resource_id, role, created_at, updated_at, invited_by)
		VALUES ($1, 'group', $2, $3, $4, $5, $6)
		RETURNING id
	`, member.UserID, groupID, member.Role, now, now, addedBy).Scan(&memberID)

	if err != nil {
		return member, err
	}
	member.ID = memberID

	// Get the full member info with user details
	return s.GetGroupMember(groupID, req.UserID)
}

// UpdateGroupMember updates a group member
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) UpdateGroupMember(groupID, userID string, req db.UpdateGroupMemberRequest) (db.GroupMember, error) {
	// Get current member
	member, err := s.GetGroupMember(groupID, userID)
	if err != nil {
		return member, err
	}

	// Update role if provided - map 'leader' to 'admin' for ReBAC consistency
	if req.Role != nil {
		role := *req.Role
		if role == db.GroupMemberRoleLeader {
			role = "admin"
		}
		member.Role = role
	}

	// Note: escalation_order and notification_preferences belong to Scheduler tables
	// IsActive is not used in memberships (delete row instead)

	_, err = s.PG.Exec(`
		UPDATE memberships
		SET role = $3, updated_at = NOW()
		WHERE resource_type = 'group' AND resource_id = $1 AND user_id = $2
	`, groupID, userID, member.Role)

	return member, err
}

// RemoveGroupMember removes a user from a group
// ReBAC: Deletes row from memberships table (no soft delete)
func (s *GroupService) RemoveGroupMember(groupID, userID string) error {
	_, err := s.PG.Exec(`DELETE FROM memberships WHERE resource_type = 'group' AND resource_id = $1 AND user_id = $2`, groupID, userID)
	return err
}

// UTILITY METHODS

// GetUserGroups returns all groups that a user belongs to
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) GetUserGroups(userID string) ([]db.Group, error) {
	query := `
		SELECT
			g.id, g.name, g.description, g.type, g.visibility, g.is_active, g.created_at, g.updated_at,
			COALESCE(uc.name, 'Unknown') as created_by,
			g.escalation_timeout, g.escalation_method,
			COALESCE(mc.member_count, 0) as member_count,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM groups g
		JOIN memberships m ON g.id = m.resource_id AND m.resource_type = 'group'
		JOIN users u ON m.user_id = u.id
		LEFT JOIN users uc ON g.created_by = uc.id
		LEFT JOIN (
			SELECT resource_id, COUNT(*) as member_count
			FROM memberships
			WHERE resource_type = 'group'
			GROUP BY resource_id
		) mc ON g.id = mc.resource_id
		WHERE m.user_id = $1
		ORDER BY g.created_at DESC
	`

	rows, err := s.PG.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []db.Group
	for rows.Next() {
		var g db.Group
		err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.Type, &g.Visibility, &g.IsActive,
			&g.CreatedAt, &g.UpdatedAt, &g.CreatedBy,
			&g.EscalationTimeout, &g.EscalationMethod, &g.MemberCount,
			&g.UserName, &g.UserEmail, &g.UserTeam,
		)
		if err != nil {
			continue
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// GetGroupsByType returns groups filtered by type
// DEPRECATED: Use ListGroups with filters instead (requires ReBAC context)
func (s *GroupService) GetGroupsByType(groupType string, filters map[string]interface{}) ([]db.Group, error) {
	if filters == nil {
		filters = make(map[string]interface{})
	}
	filters["type"] = groupType
	filters["active_only"] = true
	return s.ListGroups(filters)
}

// IsUserInGroup checks if a user is a member of a group
// ReBAC: Uses memberships table with resource_type = 'group'
func (s *GroupService) IsUserInGroup(groupID, userID string) (bool, error) {
	var count int
	err := s.PG.QueryRow(`
		SELECT COUNT(*) FROM memberships
		WHERE resource_type = 'group' AND resource_id = $1 AND user_id = $2
	`, groupID, userID).Scan(&count)

	return count > 0, err
}

// GetGroupLeaders returns all leaders (admins) of a group
// ReBAC: Uses memberships table with resource_type = 'group', role = 'admin'
func (s *GroupService) GetGroupLeaders(groupID string) ([]db.GroupMember, error) {
	query := `
		SELECT
			m.id, m.resource_id as group_id, m.user_id, m.role,
			m.created_at as added_at, COALESCE(m.invited_by::text, '') as added_by,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM memberships m
		JOIN users u ON m.user_id = u.id
		WHERE m.resource_type = 'group' AND m.resource_id = $1 AND m.role = 'admin'
		ORDER BY m.created_at ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var leaders []db.GroupMember
	for rows.Next() {
		var m db.GroupMember
		err := rows.Scan(
			&m.ID, &m.GroupID, &m.UserID, &m.Role,
			&m.AddedAt, &m.AddedBy,
			&m.UserName, &m.UserEmail, &m.UserTeam,
		)
		if err != nil {
			continue
		}
		m.IsActive = true
		m.EscalationOrder = 0 // Escalation order belongs to Scheduler tables
		leaders = append(leaders, m)
	}
	return leaders, nil
}

// GetEscalationGroups returns all groups that can be used for escalation
// DEPRECATED: Use ListGroups with filters instead (requires ReBAC context)
func (s *GroupService) GetEscalationGroups(filters map[string]interface{}) ([]db.Group, error) {
	return s.GetGroupsByType(db.GroupTypeEscalation, filters)
}
