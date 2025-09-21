package services

import (
	"database/sql"
	"encoding/json"
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

// ListGroups returns all groups with optional filtering (Admin only)
func (s *GroupService) ListGroups(groupType string, isActive *bool) ([]db.Group, error) {
	query := `
		SELECT g.id, g.name, g.description, g.type, g.visibility, g.is_active, g.created_at, g.updated_at, 
		       COALESCE(u.name, 'Unknown') as created_by, 
		       g.escalation_timeout, g.escalation_method,
		       COALESCE(mc.member_count, 0) as member_count
		FROM groups g
		LEFT JOIN users u ON g.created_by = u.id
		LEFT JOIN (
			SELECT group_id, COUNT(*) as member_count 
			FROM group_members 
			WHERE is_active = true 
			GROUP BY group_id
		) mc ON g.id = mc.group_id
		WHERE 1=1
	`
	args := []interface{}{}

	if groupType != "" {
		query += " AND g.type = $" + fmt.Sprintf("%d", len(args)+1)
		args = append(args, groupType)
	}

	if isActive != nil {
		query += " AND g.is_active = $" + fmt.Sprintf("%d", len(args)+1)
		args = append(args, *isActive)
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
func (s *GroupService) ListUserScopedGroups(userID, groupType string, isActive *bool) ([]db.Group, error) {
	query := `
		SELECT DISTINCT g.id, g.name, g.description, g.type, g.visibility, g.is_active, 
		       g.created_at, g.updated_at, COALESCE(u.name, 'Unknown') as created_by, 
		       g.escalation_timeout, g.escalation_method,
		       COALESCE(mc.member_count, 0) as member_count,
		       CASE WHEN gm.user_id IS NOT NULL THEN true ELSE false END as is_member
		FROM groups g
		LEFT JOIN users u ON g.created_by = u.id
		LEFT JOIN (
			SELECT group_id, COUNT(*) as member_count 
			FROM group_members 
			WHERE is_active = true 
			GROUP BY group_id
		) mc ON g.id = mc.group_id
		LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = $1 AND gm.is_active = true
		WHERE (g.visibility IN ('public', 'organization') OR gm.user_id IS NOT NULL)
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
func (s *GroupService) ListPublicGroups(userID, groupType string) ([]db.Group, error) {
	query := `
		SELECT g.id, g.name, g.description, g.type, g.visibility, g.is_active, 
		       g.created_at, g.updated_at, COALESCE(u.name, 'Unknown') as created_by, 
		       g.escalation_timeout, g.escalation_method,
		       COALESCE(mc.member_count, 0) as member_count,
		       CASE WHEN gm.user_id IS NOT NULL THEN true ELSE false END as is_member
		FROM groups g
		LEFT JOIN users u ON g.created_by = u.id
		LEFT JOIN (
			SELECT group_id, COUNT(*) as member_count 
			FROM group_members 
			WHERE is_active = true 
			GROUP BY group_id
		) mc ON g.id = mc.group_id
		LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = $1 AND gm.is_active = true
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
			SELECT group_id, COUNT(*) as member_count 
			FROM group_members 
			WHERE is_active = true 
			GROUP BY group_id
		) mc ON g.id = mc.group_id
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
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		Type:        req.Type,
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		CreatedBy:   createdBy,
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

	// Create the group
	_, err = tx.Exec(`
		INSERT INTO groups (id, name, description, type, visibility, is_active, created_at, updated_at, created_by, escalation_timeout, escalation_method)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, group.ID, group.Name, group.Description, group.Type, group.Visibility, group.IsActive, group.CreatedAt, group.UpdatedAt, group.CreatedBy, group.EscalationTimeout, group.EscalationMethod)
	if err != nil {
		return group, err
	}

	// Auto-add creator as group leader
	memberID := uuid.New().String()
	_, err = tx.Exec(`
		INSERT INTO group_members (id, group_id, user_id, role, is_active, escalation_order, notification_preferences, added_at, added_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, memberID, group.ID, createdBy, db.GroupMemberRoleLeader, true, 1, `{"fcm": true, "email": true, "sms": false}`, group.CreatedAt, createdBy)
	if err != nil {
		return group, err
	}

	// Commit transaction
	err = tx.Commit()
	return group, err
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
func (s *GroupService) GetGroupMembers(groupID string) ([]db.GroupMember, error) {
	query := `
		SELECT 
			gm.id, gm.group_id, gm.user_id, gm.role, gm.escalation_order, gm.is_active, 
			gm.added_at, COALESCE(gm.added_by, '') as added_by, 
			COALESCE(gm.notification_preferences, '{}') as notification_preferences,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM group_members gm
		JOIN users u ON gm.user_id = u.id
		WHERE gm.group_id = $1 AND gm.is_active = true
		ORDER BY gm.escalation_order ASC, gm.added_at ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []db.GroupMember
	for rows.Next() {
		var m db.GroupMember
		var prefsJSON []byte
		err := rows.Scan(
			&m.ID, &m.GroupID, &m.UserID, &m.Role, &m.EscalationOrder, &m.IsActive,
			&m.AddedAt, &m.AddedBy, &prefsJSON,
			&m.UserName, &m.UserEmail, &m.UserTeam,
		)
		if err != nil {
			continue
		}

		// Parse notification preferences
		if len(prefsJSON) > 0 {
			json.Unmarshal(prefsJSON, &m.NotificationPreferences)
		}

		members = append(members, m)
	}
	return members, nil
}

// GetGroupMember returns a specific group member
func (s *GroupService) GetGroupMember(groupID, userID string) (db.GroupMember, error) {
	var m db.GroupMember
	var prefsJSON []byte
	err := s.PG.QueryRow(`
		SELECT 
			gm.id, gm.group_id, gm.user_id, gm.role, gm.escalation_order, gm.is_active, 
			gm.added_at, COALESCE(gm.added_by, '') as added_by, 
			COALESCE(gm.notification_preferences, '{}') as notification_preferences,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM group_members gm
		JOIN users u ON gm.user_id = u.id
		WHERE gm.group_id = $1 AND gm.user_id = $2
	`, groupID, userID).Scan(
		&m.ID, &m.GroupID, &m.UserID, &m.Role, &m.EscalationOrder, &m.IsActive,
		&m.AddedAt, &m.AddedBy, &prefsJSON,
		&m.UserName, &m.UserEmail, &m.UserTeam,
	)

	// Parse notification preferences
	if len(prefsJSON) > 0 {
		json.Unmarshal(prefsJSON, &m.NotificationPreferences)
	}

	return m, err
}

// AddGroupMember adds a user to a group
func (s *GroupService) AddGroupMember(groupID string, req db.AddGroupMemberRequest, addedBy string) (db.GroupMember, error) {
	member := db.GroupMember{
		ID:       uuid.New().String(),
		GroupID:  groupID,
		UserID:   req.UserID,
		Role:     req.Role,
		IsActive: true,
		AddedAt:  time.Now(),
		AddedBy:  addedBy,
	}

	// Set default values
	if member.Role == "" {
		member.Role = db.GroupMemberRoleMember
	}
	if req.EscalationOrder > 0 {
		member.EscalationOrder = req.EscalationOrder
	} else {
		member.EscalationOrder = 1
	}

	// Set notification preferences
	if req.NotificationPreferences != nil {
		member.NotificationPreferences = req.NotificationPreferences
	} else {
		member.NotificationPreferences = map[string]interface{}{
			"fcm":   true,
			"email": true,
			"sms":   false,
		}
	}

	prefsJSON, _ := json.Marshal(member.NotificationPreferences)

	_, err := s.PG.Exec(`
		INSERT INTO group_members (id, group_id, user_id, role, escalation_order, is_active, added_at, added_by, notification_preferences)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, member.ID, member.GroupID, member.UserID, member.Role, member.EscalationOrder, member.IsActive, member.AddedAt, member.AddedBy, prefsJSON)

	if err != nil {
		return member, err
	}

	// Get the full member info with user details
	return s.GetGroupMember(groupID, req.UserID)
}

// UpdateGroupMember updates a group member
func (s *GroupService) UpdateGroupMember(groupID, userID string, req db.UpdateGroupMemberRequest) (db.GroupMember, error) {
	// Get current member
	member, err := s.GetGroupMember(groupID, userID)
	if err != nil {
		return member, err
	}

	// Update fields if provided
	if req.Role != nil {
		member.Role = *req.Role
	}
	if req.EscalationOrder != nil {
		member.EscalationOrder = *req.EscalationOrder
	}
	if req.IsActive != nil {
		member.IsActive = *req.IsActive
	}
	if req.NotificationPreferences != nil {
		member.NotificationPreferences = req.NotificationPreferences
	}

	prefsJSON, _ := json.Marshal(member.NotificationPreferences)

	_, err = s.PG.Exec(`
		UPDATE group_members 
		SET role = $3, escalation_order = $4, is_active = $5, notification_preferences = $6
		WHERE group_id = $1 AND user_id = $2
	`, groupID, userID, member.Role, member.EscalationOrder, member.IsActive, prefsJSON)

	return member, err
}

// RemoveGroupMember removes a user from a group
func (s *GroupService) RemoveGroupMember(groupID, userID string) error {
	_, err := s.PG.Exec(`UPDATE group_members SET is_active = false WHERE group_id = $1 AND user_id = $2`, groupID, userID)
	return err
}

// UTILITY METHODS

// GetUserGroups returns all groups that a user belongs to
func (s *GroupService) GetUserGroups(userID string) ([]db.Group, error) {
	query := `
		SELECT 
			g.id, g.name, g.description, g.type, g.visibility, g.is_active, g.created_at, g.updated_at, 
			COALESCE(uc.name, 'Unknown') as created_by,
			g.escalation_timeout, g.escalation_method,
			COALESCE(mc.member_count, 0) as member_count,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM groups g
		JOIN group_members gm ON g.id = gm.group_id
		JOIN users u ON gm.user_id = u.id
		LEFT JOIN users uc ON g.created_by = uc.id
		LEFT JOIN (
			SELECT group_id, COUNT(*) as member_count 
			FROM group_members 
			WHERE is_active = true 
			GROUP BY group_id
		) mc ON g.id = mc.group_id
		WHERE gm.user_id = $1 AND gm.is_active = true
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
func (s *GroupService) GetGroupsByType(groupType string) ([]db.Group, error) {
	isActive := true
	return s.ListGroups(groupType, &isActive)
}

// IsUserInGroup checks if a user is a member of a group
func (s *GroupService) IsUserInGroup(groupID, userID string) (bool, error) {
	var count int
	err := s.PG.QueryRow(`
		SELECT COUNT(*) FROM group_members 
		WHERE group_id = $1 AND user_id = $2 AND is_active = true
	`, groupID, userID).Scan(&count)

	return count > 0, err
}

// GetGroupLeaders returns all leaders of a group
func (s *GroupService) GetGroupLeaders(groupID string) ([]db.GroupMember, error) {
	query := `
		SELECT 
			gm.id, gm.group_id, gm.user_id, gm.role, gm.escalation_order, gm.is_active, 
			gm.added_at, COALESCE(gm.added_by, '') as added_by, 
			COALESCE(gm.notification_preferences, '{}') as notification_preferences,
			u.name as user_name, u.email as user_email, u.team as user_team
		FROM group_members gm
		JOIN users u ON gm.user_id = u.id
		WHERE gm.group_id = $1 AND gm.role = 'leader' AND gm.is_active = true
		ORDER BY gm.escalation_order ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var leaders []db.GroupMember
	for rows.Next() {
		var m db.GroupMember
		var prefsJSON []byte
		err := rows.Scan(
			&m.ID, &m.GroupID, &m.UserID, &m.Role, &m.EscalationOrder, &m.IsActive,
			&m.AddedAt, &m.AddedBy, &prefsJSON,
			&m.UserName, &m.UserEmail, &m.UserTeam,
		)
		if err != nil {
			continue
		}

		// Parse notification preferences
		if len(prefsJSON) > 0 {
			json.Unmarshal(prefsJSON, &m.NotificationPreferences)
		}

		leaders = append(leaders, m)
	}
	return leaders, nil
}

// GetEscalationGroups returns all groups that can be used for escalation
func (s *GroupService) GetEscalationGroups() ([]db.Group, error) {
	return s.GetGroupsByType(db.GroupTypeEscalation)
}
