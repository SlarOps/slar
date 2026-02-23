package services

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

// PolicyService handles CRUD operations for agent_policies.
type PolicyService struct {
	PG *sql.DB
}

// NewPolicyService creates a new PolicyService.
func NewPolicyService(pg *sql.DB) *PolicyService {
	return &PolicyService{PG: pg}
}

// ListPolicies returns policies scoped to an org (and optionally a project).
// Computed Scope: returns org-wide policies (project_id IS NULL) PLUS
// project-specific policies for the given project_id.
func (s *PolicyService) ListPolicies(filters map[string]interface{}) ([]db.AgentPolicy, error) {
	orgID, ok := filters["org_id"].(string)
	if !ok || orgID == "" {
		return []db.AgentPolicy{}, nil
	}

	args := []interface{}{orgID}
	argIdx := 2

	query := `
		SELECT id, created_at, updated_at, org_id, project_id, name, description,
		       effect, principal_type, principal_value, tool_pattern, priority,
		       is_active, created_by
		FROM agent_policies
		WHERE org_id = $1
	`

	// Project filter: Computed Scope (org-wide + project-specific) or specific project
	if projectID, ok := filters["project_id"].(string); ok && projectID != "" {
		query += fmt.Sprintf(" AND (project_id IS NULL OR project_id = $%d)", argIdx)
		args = append(args, projectID)
		argIdx++
	}

	// Active only filter
	if activeOnly, ok := filters["active_only"].(bool); ok && activeOnly {
		query += " AND is_active = TRUE"
	}

	query += " ORDER BY priority DESC, created_at ASC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("ListPolicies query: %w", err)
	}
	defer rows.Close()

	var policies []db.AgentPolicy
	for rows.Next() {
		var p db.AgentPolicy
		if err := rows.Scan(
			&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.OrgID, &p.ProjectID,
			&p.Name, &p.Description, &p.Effect, &p.PrincipalType, &p.PrincipalValue,
			&p.ToolPattern, &p.Priority, &p.IsActive, &p.CreatedBy,
		); err != nil {
			return nil, fmt.Errorf("ListPolicies scan: %w", err)
		}
		policies = append(policies, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListPolicies rows: %w", err)
	}

	if policies == nil {
		policies = []db.AgentPolicy{}
	}
	return policies, nil
}

// GetPolicy retrieves a single policy by ID within the org (tenant isolation).
func (s *PolicyService) GetPolicy(id, orgID string) (*db.AgentPolicy, error) {
	var p db.AgentPolicy
	err := s.PG.QueryRow(`
		SELECT id, created_at, updated_at, org_id, project_id, name, description,
		       effect, principal_type, principal_value, tool_pattern, priority,
		       is_active, created_by
		FROM agent_policies
		WHERE id = $1 AND org_id = $2
	`, id, orgID).Scan(
		&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.OrgID, &p.ProjectID,
		&p.Name, &p.Description, &p.Effect, &p.PrincipalType, &p.PrincipalValue,
		&p.ToolPattern, &p.Priority, &p.IsActive, &p.CreatedBy,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetPolicy: %w", err)
	}
	return &p, nil
}

// CreatePolicy inserts a new policy and returns the created record.
func (s *PolicyService) CreatePolicy(req *db.CreatePolicyRequest, createdBy string) (*db.AgentPolicy, error) {
	id := uuid.New().String()

	var p db.AgentPolicy
	err := s.PG.QueryRow(`
		INSERT INTO agent_policies
		    (id, org_id, project_id, name, description, effect, principal_type,
		     principal_value, tool_pattern, priority, is_active, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
		RETURNING id, created_at, updated_at, org_id, project_id, name, description,
		          effect, principal_type, principal_value, tool_pattern, priority,
		          is_active, created_by
	`,
		id, req.OrgID, req.ProjectID, req.Name, req.Description,
		req.Effect, req.PrincipalType, req.PrincipalValue,
		req.ToolPattern, req.Priority, nullableString(createdBy),
	).Scan(
		&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.OrgID, &p.ProjectID,
		&p.Name, &p.Description, &p.Effect, &p.PrincipalType, &p.PrincipalValue,
		&p.ToolPattern, &p.Priority, &p.IsActive, &p.CreatedBy,
	)
	if err != nil {
		return nil, fmt.Errorf("CreatePolicy: %w", err)
	}
	return &p, nil
}

// UpdatePolicy applies partial updates to a policy and returns the updated record.
func (s *PolicyService) UpdatePolicy(id, orgID string, req *db.UpdatePolicyRequest) (*db.AgentPolicy, error) {
	// Build SET clause dynamically (COALESCE pattern for partial update)
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.Name != nil {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *req.Name)
		argIdx++
	}
	if req.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *req.Description)
		argIdx++
	}
	if req.Effect != nil {
		setClauses = append(setClauses, fmt.Sprintf("effect = $%d", argIdx))
		args = append(args, *req.Effect)
		argIdx++
	}
	if req.PrincipalType != nil {
		setClauses = append(setClauses, fmt.Sprintf("principal_type = $%d", argIdx))
		args = append(args, *req.PrincipalType)
		argIdx++
	}
	if req.PrincipalValue != nil {
		setClauses = append(setClauses, fmt.Sprintf("principal_value = $%d", argIdx))
		args = append(args, *req.PrincipalValue)
		argIdx++
	}
	if req.ToolPattern != nil {
		setClauses = append(setClauses, fmt.Sprintf("tool_pattern = $%d", argIdx))
		args = append(args, *req.ToolPattern)
		argIdx++
	}
	if req.Priority != nil {
		setClauses = append(setClauses, fmt.Sprintf("priority = $%d", argIdx))
		args = append(args, *req.Priority)
		argIdx++
	}
	if req.IsActive != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_active = $%d", argIdx))
		args = append(args, *req.IsActive)
		argIdx++
	}

	if len(setClauses) == 0 {
		return s.GetPolicy(id, orgID)
	}

	// Build final query
	query := "UPDATE agent_policies SET "
	for i, clause := range setClauses {
		if i > 0 {
			query += ", "
		}
		query += clause
	}
	query += fmt.Sprintf(" WHERE id = $%d AND org_id = $%d", argIdx, argIdx+1)
	query += ` RETURNING id, created_at, updated_at, org_id, project_id, name, description,
	           effect, principal_type, principal_value, tool_pattern, priority,
	           is_active, created_by`
	args = append(args, id, orgID)

	var p db.AgentPolicy
	err := s.PG.QueryRow(query, args...).Scan(
		&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.OrgID, &p.ProjectID,
		&p.Name, &p.Description, &p.Effect, &p.PrincipalType, &p.PrincipalValue,
		&p.ToolPattern, &p.Priority, &p.IsActive, &p.CreatedBy,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("UpdatePolicy: %w", err)
	}
	return &p, nil
}

// DeletePolicy removes a policy by ID within the org (tenant isolation).
func (s *PolicyService) DeletePolicy(id, orgID string) (bool, error) {
	result, err := s.PG.Exec(`
		DELETE FROM agent_policies WHERE id = $1 AND org_id = $2
	`, id, orgID)
	if err != nil {
		return false, fmt.Errorf("DeletePolicy: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

// GetPolicyVersion returns the current version counter for an org's policies.
// Returns version=0 if no policies have been created yet.
func (s *PolicyService) GetPolicyVersion(orgID string) (int64, error) {
	var version int64
	err := s.PG.QueryRow(`
		SELECT version FROM agent_policy_versions WHERE org_id = $1
	`, orgID).Scan(&version)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("GetPolicyVersion: %w", err)
	}
	return version, nil
}

// nullableString converts a string to a *string, returning nil for empty strings.
func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
