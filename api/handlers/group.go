package handlers

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type GroupHandler struct {
	GroupService      *services.GroupService
	EscalationService *services.EscalationService
}

func NewGroupHandler(groupService *services.GroupService, escalationService *services.EscalationService) *GroupHandler {
	return &GroupHandler{
		GroupService:      groupService,
		EscalationService: escalationService,
	}
}

// GROUP MANAGEMENT ENDPOINTS

// ListGroups retrieves all groups with optional filtering
func (h *GroupHandler) ListGroups(c *gin.Context) {
	groupType := c.Query("type")
	activeOnlyParam := c.Query("active_only")

	var activeOnly *bool
	if activeOnlyParam != "" {
		val, err := strconv.ParseBool(activeOnlyParam)
		if err == nil {
			activeOnly = &val
		}
	}

	groups, err := h.GroupService.ListGroups(groupType, activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve groups"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"groups": groups,
		"total":  len(groups),
	})
}

// GetGroup retrieves a specific group by ID
func (h *GroupHandler) GetGroup(c *gin.Context) {
	id := c.Param("id")

	group, err := h.GroupService.GetGroup(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	c.JSON(http.StatusOK, group)
}

// GetGroupWithMembers retrieves a group with all its members
func (h *GroupHandler) GetGroupWithMembers(c *gin.Context) {
	id := c.Param("id")

	groupWithMembers, err := h.GroupService.GetGroupWithMembers(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	c.JSON(http.StatusOK, groupWithMembers)
}

// CreateGroup creates a new group
func (h *GroupHandler) CreateGroup(c *gin.Context) {
	var req db.CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	group, err := h.GroupService.CreateGroup(req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create group"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"group":   group,
		"message": "Group created successfully",
	})
}

// UpdateGroup updates an existing group
func (h *GroupHandler) UpdateGroup(c *gin.Context) {
	id := c.Param("id")

	var req db.UpdateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	group, err := h.GroupService.UpdateGroup(id, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update group"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"group":   group,
		"message": "Group updated successfully",
	})
}

// DeleteGroup soft deletes a group
func (h *GroupHandler) DeleteGroup(c *gin.Context) {
	id := c.Param("id")

	err := h.GroupService.DeleteGroup(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete group"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Group deleted successfully"})
}

// GROUP MEMBER MANAGEMENT ENDPOINTS

// GetGroupMembers retrieves all members of a group
func (h *GroupHandler) GetGroupMembers(c *gin.Context) {
	groupID := c.Param("id")

	members, err := h.GroupService.GetGroupMembers(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve group members"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"members": members,
		"total":   len(members),
	})
}

// AddGroupMember adds a user to a group
func (h *GroupHandler) AddGroupMember(c *gin.Context) {
	groupID := c.Param("id")

	var req db.AddGroupMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	member, err := h.GroupService.AddGroupMember(groupID, req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add group member"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"member":  member,
		"message": "Member added to group successfully",
	})
}

// UpdateGroupMember updates a group member
func (h *GroupHandler) UpdateGroupMember(c *gin.Context) {
	groupID := c.Param("id")
	memberUserID := c.Param("user_id")

	var req db.UpdateGroupMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	member, err := h.GroupService.UpdateGroupMember(groupID, memberUserID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update group member"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"member":  member,
		"message": "Group member updated successfully",
	})
}

// RemoveGroupMember removes a user from a group
func (h *GroupHandler) RemoveGroupMember(c *gin.Context) {
	groupID := c.Param("id")
	memberUserID := c.Param("user_id")

	err := h.GroupService.RemoveGroupMember(groupID, memberUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove group member"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member removed from group successfully"})
}

// ESCALATION RULE MANAGEMENT ENDPOINTS

// ListEscalationPolicies retrieves all escalation policies
func (h *GroupHandler) ListEscalationPolicies(c *gin.Context) {
	activeOnlyParam := c.Query("active_only")
	activeOnly := activeOnlyParam == "true"

	policies, err := h.EscalationService.ListEscalationPolicies(activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve escalation policies"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"policies": policies,
		"total":    len(policies),
	})
}

// GetEscalationPolicy retrieves a specific escalation policy
func (h *GroupHandler) GetEscalationPolicy(c *gin.Context) {
	id := c.Param("id")

	policy, err := h.EscalationService.GetEscalationPolicy(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Escalation policy not found"})
		return
	}

	c.JSON(http.StatusOK, policy)
}

// GetEscalationPolicyWithLevels retrieves escalation policy with its levels
func (h *GroupHandler) GetEscalationPolicyWithLevels(c *gin.Context) {
	id := c.Param("id")

	policyWithLevels, err := h.EscalationService.GetEscalationPolicyWithLevels(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Escalation policy not found"})
		return
	}

	c.JSON(http.StatusOK, policyWithLevels)
}

// GetEscalationPolicyDetail retrieves escalation policy with complete details including target information
func (h *GroupHandler) GetEscalationPolicyDetail(c *gin.Context) {
	policyID := c.Param("policy_id")

	log.Printf("GetEscalationPolicyDetail called with policy_id: '%s'", policyID)

	if policyID == "" {
		log.Println("Error: Policy ID is empty")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Policy ID is required"})
		return
	}

	policyDetail, err := h.EscalationService.GetEscalationPolicyDetailWithSteps(policyID)
	if err != nil {
		log.Printf("Error getting escalation policy detail: %v", err)
		if strings.Contains(err.Error(), "policy ID cannot be empty") ||
			strings.Contains(err.Error(), "escalation policy not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "Escalation policy not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve escalation policy details"})
		}
		return
	}

	log.Printf("Successfully retrieved policy detail with %d steps: %s", len(policyDetail.Steps), policyDetail.Name)
	c.JSON(http.StatusOK, policyDetail)
}

// CreateEscalationPolicy creates a new escalation policy
func (h *GroupHandler) CreateEscalationPolicy(c *gin.Context) {
	groupID := c.Param("id")

	var escalationPolicy db.EscalationPolicy
	if err := c.ShouldBindJSON(&escalationPolicy); err != nil {
		log.Println("Error binding JSON:", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	log.Println("Escalation policy:", escalationPolicy)

	policy, err := h.EscalationService.CreateEscalationPolicy(groupID, escalationPolicy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create escalation policy"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"policy":  policy,
		"message": "Escalation policy created successfully",
	})
}

// GetGroupEscalationPolicies retrieves escalation policies for a specific group
func (h *GroupHandler) GetGroupEscalationPolicies(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	// Get active only by default, can be overridden with query param
	activeOnlyParam := c.Query("active_only")
	activeOnly := activeOnlyParam != "false" // Default to true unless explicitly set to false

	policiesWithUsage, err := h.EscalationService.GetGroupEscalationPolicies(groupID, activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve escalation policies"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"policies": policiesWithUsage,
		"count":    len(policiesWithUsage),
		"group_id": groupID,
	})
}

// ESCALATION LEVEL MANAGEMENT ENDPOINTS

// GetEscalationLevels retrieves all levels for a policy
func (h *GroupHandler) GetEscalationLevels(c *gin.Context) {
	policyID := c.Param("id")

	levels, err := h.EscalationService.GetEscalationLevels(policyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve escalation levels"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"levels": levels,
		"total":  len(levels),
	})
}

// NOTE: CreateEscalationLevel is deprecated in Datadog-style architecture
// Escalation levels are now created as part of the escalation policy
// Use CreateEscalationPolicy instead

// UTILITY ENDPOINTS

// GetUserGroups retrieves all groups that a user belongs to
func (h *GroupHandler) GetUserGroups(c *gin.Context) {
	userID := c.Param("user_id")

	groups, err := h.GroupService.GetUserGroups(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user groups"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"groups": groups,
		"total":  len(groups),
	})
}

// GetMyGroups retrieves groups for the authenticated user (user-scoped view)
func (h *GroupHandler) GetMyGroups(c *gin.Context) {
	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	groupType := c.Query("type")
	activeOnlyParam := c.Query("active_only")

	var activeOnly *bool
	if activeOnlyParam != "" {
		val, err := strconv.ParseBool(activeOnlyParam)
		if err == nil {
			activeOnly = &val
		}
	}

	groups, err := h.GroupService.ListUserScopedGroups(userID.(string), groupType, activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve groups"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"groups": groups,
		"total":  len(groups),
	})
}

// GetPublicGroups retrieves public groups that user can discover and join
func (h *GroupHandler) GetPublicGroups(c *gin.Context) {
	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	groupType := c.Query("type")

	groups, err := h.GroupService.ListPublicGroups(userID.(string), groupType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve public groups"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"groups": groups,
		"total":  len(groups),
	})
}

// GetCurrentUserGroups retrieves groups for the current authenticated user
func (h *GroupHandler) GetCurrentUserGroups(c *gin.Context) {
	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	groups, err := h.GroupService.GetUserGroups(userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user groups"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"groups": groups,
		"total":  len(groups),
	})
}

// GetEscalationGroups retrieves all groups that can be used for escalation
func (h *GroupHandler) GetEscalationGroups(c *gin.Context) {
	groups, err := h.GroupService.GetEscalationGroups()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve escalation groups"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"groups": groups,
		"total":  len(groups),
	})
}

// GetAlertEscalations retrieves escalation history for an alert
func (h *GroupHandler) GetAlertEscalations(c *gin.Context) {
	alertID := c.Param("alert_id")

	escalations, err := h.EscalationService.GetAlertEscalations(alertID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve alert escalations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"escalations": escalations,
		"total":       len(escalations),
	})
}

// BULK OPERATIONS

// AddMultipleGroupMembers adds multiple users to a group
func (h *GroupHandler) AddMultipleGroupMembers(c *gin.Context) {
	groupID := c.Param("id")

	var req struct {
		Members []db.AddGroupMemberRequest `json:"members" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var addedMembers []db.GroupMember
	var errors []string

	for _, memberReq := range req.Members {
		member, err := h.GroupService.AddGroupMember(groupID, memberReq, userID.(string))
		if err != nil {
			errors = append(errors, "Failed to add user "+memberReq.UserID+": "+err.Error())
		} else {
			addedMembers = append(addedMembers, member)
		}
	}

	response := gin.H{
		"added_members": addedMembers,
		"success_count": len(addedMembers),
		"total_count":   len(req.Members),
	}

	if len(errors) > 0 {
		response["errors"] = errors
		response["error_count"] = len(errors)
	}

	statusCode := http.StatusCreated
	if len(addedMembers) == 0 {
		statusCode = http.StatusBadRequest
	} else if len(errors) > 0 {
		statusCode = http.StatusPartialContent
	}

	c.JSON(statusCode, response)
}

// GetGroupStatistics retrieves statistics for a group
func (h *GroupHandler) GetGroupStatistics(c *gin.Context) {
	groupID := c.Param("id")

	// Get group info
	group, err := h.GroupService.GetGroup(groupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	// Get members
	members, err := h.GroupService.GetGroupMembers(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve group members"})
		return
	}

	// Calculate statistics
	memberCount := len(members)
	roleStats := make(map[string]int)
	notificationStats := map[string]int{
		"fcm_enabled":   0,
		"email_enabled": 0,
		"sms_enabled":   0,
	}

	for _, member := range members {
		roleStats[member.Role]++
		if prefs := member.NotificationPreferences; prefs != nil {
			if val, ok := prefs["fcm"].(bool); ok && val {
				notificationStats["fcm_enabled"]++
			}
			if val, ok := prefs["email"].(bool); ok && val {
				notificationStats["email_enabled"]++
			}
			if val, ok := prefs["sms"].(bool); ok && val {
				notificationStats["sms_enabled"]++
			}
		}
	}

	// TODO: Add escalation statistics (number of escalations, average response time, etc.)

	statistics := gin.H{
		"group_id":           group.ID,
		"group_name":         group.Name,
		"group_type":         group.Type,
		"member_count":       memberCount,
		"role_distribution":  roleStats,
		"notification_stats": notificationStats,
		"escalation_method":  group.EscalationMethod,
		"escalation_timeout": group.EscalationTimeout,
		"is_active":          group.IsActive,
		"created_at":         group.CreatedAt,
	}

	c.JSON(http.StatusOK, statistics)
}

// UpdateEscalationPolicy updates an existing escalation policy
func (h *GroupHandler) UpdateEscalationPolicy(c *gin.Context) {
	groupID := c.Param("id")
	policyID := c.Param("policy_id")

	var req db.EscalationPolicy
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	// Validate group access
	userID := c.GetString("user_id")
	ok, err := h.GroupService.IsUserInGroup(groupID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check group membership"})
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Update escalation policy
	policy, err := h.EscalationService.UpdateEscalationPolicy(policyID, req)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "Escalation policy not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update escalation policy", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"policy":  policy,
		"message": "Escalation policy updated successfully",
	})
}

// DeleteEscalationPolicy deletes an escalation policy
func (h *GroupHandler) DeleteEscalationPolicy(c *gin.Context) {
	groupID := c.Param("id")
	policyID := c.Param("policy_id")

	// Validate group access
	userID := c.GetString("user_id")
	ok, err := h.GroupService.IsUserInGroup(userID, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check group membership"})
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Delete escalation policy
	err = h.EscalationService.DeleteEscalationPolicy(policyID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "Escalation policy not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete escalation policy", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Escalation policy deleted successfully",
	})
}
