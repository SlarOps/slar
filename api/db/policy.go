package db

import (
	"database/sql"
	"time"
)

// AgentPolicy represents a declarative tool access policy for the AI agent.
// Policies allow org/project admins to control tool access by role without
// requiring user prompts for every tool invocation.
type AgentPolicy struct {
	ID             string         `json:"id"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	OrgID          string         `json:"org_id"`
	ProjectID      sql.NullString `json:"project_id"`
	Name           string         `json:"name"`
	Description    sql.NullString `json:"description"`
	Effect         string         `json:"effect"`         // "allow" | "deny"
	PrincipalType  string         `json:"principal_type"` // "role" | "user" | "*"
	PrincipalValue sql.NullString `json:"principal_value"`
	ToolPattern    string         `json:"tool_pattern"` // fnmatch glob or exact
	Priority       int            `json:"priority"`
	IsActive       bool           `json:"is_active"`
	CreatedBy      sql.NullString `json:"created_by"`
}

// AgentPolicyResponse is the JSON-serializable form of AgentPolicy with nullable fields resolved.
type AgentPolicyResponse struct {
	ID             string     `json:"id"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	OrgID          string     `json:"org_id"`
	ProjectID      *string    `json:"project_id"`
	Name           string     `json:"name"`
	Description    *string    `json:"description"`
	Effect         string     `json:"effect"`
	PrincipalType  string     `json:"principal_type"`
	PrincipalValue *string    `json:"principal_value"`
	ToolPattern    string     `json:"tool_pattern"`
	Priority       int        `json:"priority"`
	IsActive       bool       `json:"is_active"`
	CreatedBy      *string    `json:"created_by"`
}

// ToResponse converts AgentPolicy to the JSON-serializable response form.
func (p *AgentPolicy) ToResponse() AgentPolicyResponse {
	resp := AgentPolicyResponse{
		ID:          p.ID,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
		OrgID:       p.OrgID,
		Name:        p.Name,
		Effect:      p.Effect,
		PrincipalType: p.PrincipalType,
		ToolPattern: p.ToolPattern,
		Priority:    p.Priority,
		IsActive:    p.IsActive,
	}
	if p.ProjectID.Valid {
		resp.ProjectID = &p.ProjectID.String
	}
	if p.Description.Valid {
		resp.Description = &p.Description.String
	}
	if p.PrincipalValue.Valid {
		resp.PrincipalValue = &p.PrincipalValue.String
	}
	if p.CreatedBy.Valid {
		resp.CreatedBy = &p.CreatedBy.String
	}
	return resp
}

// CreatePolicyRequest is the request body for creating a new policy.
type CreatePolicyRequest struct {
	OrgID          string  `json:"org_id"          binding:"required"`
	ProjectID      *string `json:"project_id"`
	Name           string  `json:"name"            binding:"required"`
	Description    *string `json:"description"`
	Effect         string  `json:"effect"          binding:"required,oneof=allow deny"`
	PrincipalType  string  `json:"principal_type"  binding:"required,oneof=role user *"`
	PrincipalValue *string `json:"principal_value"`
	ToolPattern    string  `json:"tool_pattern"    binding:"required"`
	Priority       int     `json:"priority"`
}

// UpdatePolicyRequest is the request body for updating an existing policy.
// All fields are optional — only non-nil fields will be updated.
type UpdatePolicyRequest struct {
	Name           *string `json:"name"`
	Description    *string `json:"description"`
	Effect         *string `json:"effect"          binding:"omitempty,oneof=allow deny"`
	PrincipalType  *string `json:"principal_type"  binding:"omitempty,oneof=role user *"`
	PrincipalValue *string `json:"principal_value"`
	ToolPattern    *string `json:"tool_pattern"`
	Priority       *int    `json:"priority"`
	IsActive       *bool   `json:"is_active"`
}
