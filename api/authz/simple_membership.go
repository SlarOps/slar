package authz

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// SimpleMembershipManager implements MembershipManager using SQL
type SimpleMembershipManager struct {
	db *sql.DB
}

// NewSimpleMembershipManager creates a new SimpleMembershipManager
func NewSimpleMembershipManager(db *sql.DB) *SimpleMembershipManager {
	return &SimpleMembershipManager{db: db}
}

// Ensure SimpleMembershipManager implements MembershipManager
var _ MembershipManager = (*SimpleMembershipManager)(nil)

// AddMember adds a user to an organization or project with a role
func (m *SimpleMembershipManager) AddMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string, role Role) error {
	id := uuid.New().String()
	now := time.Now()

	_, err := m.db.ExecContext(ctx, `
		INSERT INTO memberships (id, user_id, resource_type, resource_id, role, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, resource_type, resource_id)
		DO UPDATE SET role = EXCLUDED.role, updated_at = EXCLUDED.updated_at
	`, id, userID, resourceType, resourceID, role, now, now)

	if err != nil {
		return fmt.Errorf("failed to add membership: %w", err)
	}
	return nil
}

// UpdateMemberRole updates a user's role in a resource
func (m *SimpleMembershipManager) UpdateMemberRole(ctx context.Context, userID string, resourceType ResourceType, resourceID string, newRole Role) error {
	result, err := m.db.ExecContext(ctx, `
		UPDATE memberships
		SET role = $1, updated_at = $2
		WHERE user_id = $3 AND resource_type = $4 AND resource_id = $5
	`, newRole, time.Now(), userID, resourceType, resourceID)

	if err != nil {
		return fmt.Errorf("failed to update membership: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("membership not found")
	}
	return nil
}

// RemoveMember removes a user from an organization or project
func (m *SimpleMembershipManager) RemoveMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string) error {
	result, err := m.db.ExecContext(ctx, `
		DELETE FROM memberships
		WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3
	`, userID, resourceType, resourceID)

	if err != nil {
		return fmt.Errorf("failed to remove membership: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("membership not found")
	}
	return nil
}

// GetMembership gets a specific membership
func (m *SimpleMembershipManager) GetMembership(ctx context.Context, userID string, resourceType ResourceType, resourceID string) (*Membership, error) {
	var mem Membership
	err := m.db.QueryRowContext(ctx, `
		SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at, COALESCE(invited_by, '')
		FROM memberships
		WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3
	`, userID, resourceType, resourceID).Scan(
		&mem.ID, &mem.UserID, &mem.ResourceType, &mem.ResourceID, &mem.Role, &mem.CreatedAt, &mem.UpdatedAt, &mem.InvitedBy,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("membership not found")
		}
		return nil, fmt.Errorf("failed to get membership: %w", err)
	}
	return &mem, nil
}

// GetUserMemberships returns all memberships for a user
func (m *SimpleMembershipManager) GetUserMemberships(ctx context.Context, userID string) ([]Membership, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at, COALESCE(invited_by, '')
		FROM memberships
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get memberships: %w", err)
	}
	defer rows.Close()

	return scanMemberships(rows)
}

// GetUserOrgMemberships returns all organization memberships for a user
func (m *SimpleMembershipManager) GetUserOrgMemberships(ctx context.Context, userID string) ([]Membership, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at, COALESCE(invited_by, '')
		FROM memberships
		WHERE user_id = $1 AND resource_type = 'org'
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get org memberships: %w", err)
	}
	defer rows.Close()

	return scanMemberships(rows)
}

// GetUserProjectMemberships returns all project memberships for a user
func (m *SimpleMembershipManager) GetUserProjectMemberships(ctx context.Context, userID string) ([]Membership, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at, COALESCE(invited_by, '')
		FROM memberships
		WHERE user_id = $1 AND resource_type = 'project'
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get project memberships: %w", err)
	}
	defer rows.Close()

	return scanMemberships(rows)
}

// GetResourceMembers returns all members of an organization or project
func (m *SimpleMembershipManager) GetResourceMembers(ctx context.Context, resourceType ResourceType, resourceID string) ([]Membership, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at, COALESCE(invited_by, '')
		FROM memberships
		WHERE resource_type = $1 AND resource_id = $2
		ORDER BY
			CASE role
				WHEN 'owner' THEN 1
				WHEN 'admin' THEN 2
				WHEN 'member' THEN 3
				WHEN 'viewer' THEN 4
			END,
			created_at
	`, resourceType, resourceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get members: %w", err)
	}
	defer rows.Close()

	return scanMemberships(rows)
}

// IsMember checks if a user is a member of a resource (any role)
func (m *SimpleMembershipManager) IsMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string) bool {
	var exists bool
	err := m.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM memberships
			WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3
		)
	`, userID, resourceType, resourceID).Scan(&exists)

	if err != nil {
		return false
	}
	return exists
}

// Helper function to scan membership rows
func scanMemberships(rows *sql.Rows) ([]Membership, error) {
	var memberships []Membership
	for rows.Next() {
		var mem Membership
		if err := rows.Scan(&mem.ID, &mem.UserID, &mem.ResourceType, &mem.ResourceID, &mem.Role, &mem.CreatedAt, &mem.UpdatedAt, &mem.InvitedBy); err != nil {
			return nil, fmt.Errorf("failed to scan membership: %w", err)
		}
		memberships = append(memberships, mem)
	}
	return memberships, rows.Err()
}
