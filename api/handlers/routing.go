package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type RoutingHandler struct {
	RoutingService *services.RoutingService
}

func NewRoutingHandler(routingService *services.RoutingService) *RoutingHandler {
	return &RoutingHandler{
		RoutingService: routingService,
	}
}

// ROUTING TABLE ENDPOINTS

// ListRoutingTables retrieves all routing tables
func (h *RoutingHandler) ListRoutingTables(c *gin.Context) {
	activeOnlyParam := c.Query("active_only")
	activeOnly := activeOnlyParam == "true"

	tables, err := h.RoutingService.ListRoutingTables(activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve routing tables"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"routing_tables": tables,
		"total":          len(tables),
	})
}

// GetRoutingTable retrieves a specific routing table
func (h *RoutingHandler) GetRoutingTable(c *gin.Context) {
	id := c.Param("id")

	table, err := h.RoutingService.GetRoutingTable(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Routing table not found"})
		return
	}

	c.JSON(http.StatusOK, table)
}

// GetRoutingTableWithRules retrieves a routing table with all its rules
func (h *RoutingHandler) GetRoutingTableWithRules(c *gin.Context) {
	id := c.Param("id")

	tableWithRules, err := h.RoutingService.GetRoutingTableWithRules(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Routing table not found"})
		return
	}

	c.JSON(http.StatusOK, tableWithRules)
}

// CreateRoutingTable creates a new routing table
func (h *RoutingHandler) CreateRoutingTable(c *gin.Context) {
	var req db.CreateRoutingTableRequest
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

	table, err := h.RoutingService.CreateRoutingTable(req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create routing table"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"routing_table": table,
		"message":       "Routing table created successfully",
	})
}

// UpdateRoutingTable updates an existing routing table
func (h *RoutingHandler) UpdateRoutingTable(c *gin.Context) {
	id := c.Param("id")

	var req db.UpdateRoutingTableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	table, err := h.RoutingService.UpdateRoutingTable(id, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update routing table"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"routing_table": table,
		"message":       "Routing table updated successfully",
	})
}

// DeleteRoutingTable soft deletes a routing table
func (h *RoutingHandler) DeleteRoutingTable(c *gin.Context) {
	id := c.Param("id")

	err := h.RoutingService.DeleteRoutingTable(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete routing table"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Routing table deleted successfully"})
}

// ROUTING RULES ENDPOINTS

// ListRoutingRules retrieves all rules for a routing table
func (h *RoutingHandler) ListRoutingRules(c *gin.Context) {
	tableID := c.Param("id")
	activeOnlyParam := c.Query("active_only")
	activeOnly := activeOnlyParam == "true"

	rules, err := h.RoutingService.ListRoutingRules(tableID, activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve routing rules"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"routing_rules": rules,
		"total":         len(rules),
		"table_id":      tableID,
	})
}

// GetRoutingRule retrieves a specific routing rule
func (h *RoutingHandler) GetRoutingRule(c *gin.Context) {
	id := c.Param("rule_id")

	rule, err := h.RoutingService.GetRoutingRule(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Routing rule not found"})
		return
	}

	c.JSON(http.StatusOK, rule)
}

// CreateRoutingRule creates a new routing rule
func (h *RoutingHandler) CreateRoutingRule(c *gin.Context) {
	tableID := c.Param("id")

	var req db.CreateRoutingRuleRequest
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

	rule, err := h.RoutingService.CreateRoutingRule(tableID, req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create routing rule: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"routing_rule": rule,
		"message":      "Routing rule created successfully",
	})
}

// DeleteRoutingRule soft deletes a routing rule
func (h *RoutingHandler) DeleteRoutingRule(c *gin.Context) {
	id := c.Param("rule_id")

	// For now, we'll implement this as a soft delete by setting is_active = false
	// In a production system, you'd want a proper DeleteRoutingRule method
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":   "Delete routing rule not yet implemented",
		"message": "Feature coming soon",
		"rule_id": id,
	})
}

// TESTING AND DEBUGGING ENDPOINTS

// TestRouting tests routing for given alert attributes
func (h *RoutingHandler) TestRouting(c *gin.Context) {
	var req db.TestRoutingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.RoutingService.TestRouting(req.Alert)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"matched":          false,
			"error":            err.Error(),
			"alert_attributes": req.Alert,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"matched":          true,
		"routing_result":   result,
		"alert_attributes": req.Alert,
		"message":          "Routing test completed successfully",
	})
}

// GetRoutingHistory retrieves routing history for an alert
func (h *RoutingHandler) GetRoutingHistory(c *gin.Context) {
	alertID := c.Param("alert_id")

	history, err := h.RoutingService.GetRoutingHistory(alertID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve routing history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"routing_history": history,
		"total":           len(history),
		"alert_id":        alertID,
	})
}

// GetRoutingStats provides routing statistics and metrics
func (h *RoutingHandler) GetRoutingStats(c *gin.Context) {
	// Parse optional time range parameters
	hoursParam := c.DefaultQuery("hours", "24")
	hours, err := strconv.Atoi(hoursParam)
	if err != nil || hours <= 0 {
		hours = 24
	}

	// For now, return basic stats structure
	// In production, you'd implement actual statistics queries
	stats := gin.H{
		"time_range_hours":       hours,
		"total_routes":           0,
		"successful_routes":      0,
		"failed_routes":          0,
		"avg_evaluation_time_ms": 0,
		"top_matched_rules":      []gin.H{},
		"top_target_groups":      []gin.H{},
		"evaluation_performance": gin.H{
			"fastest_ms": 0,
			"slowest_ms": 0,
			"median_ms":  0,
		},
		"message": "Routing statistics feature coming soon",
	}

	c.JSON(http.StatusOK, stats)
}

// UTILITY ENDPOINTS

// ValidateRoutingRule validates a routing rule without creating it
func (h *RoutingHandler) ValidateRoutingRule(c *gin.Context) {
	var req db.CreateRoutingRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"valid": false,
			"error": err.Error(),
		})
		return
	}

	// Basic validation
	validationErrors := []string{}

	// Check required fields
	if req.Name == "" {
		validationErrors = append(validationErrors, "name is required")
	}
	if req.TargetGroupID == "" {
		validationErrors = append(validationErrors, "target_group_id is required")
	}
	if req.MatchConditions == nil || len(req.MatchConditions) == 0 {
		validationErrors = append(validationErrors, "match_conditions is required")
	}

	// Check priority range
	if req.Priority < 0 || req.Priority > 1000 {
		validationErrors = append(validationErrors, "priority must be between 0 and 1000")
	}

	// Validate match conditions structure
	if req.MatchConditions != nil {
		// Add more sophisticated validation here
		if _, hasDefault := req.MatchConditions["default"]; hasDefault {
			// Default rules should have minimal other conditions
			if len(req.MatchConditions) > 1 {
				validationErrors = append(validationErrors, "default rules should not have additional conditions")
			}
		}
	}

	if len(validationErrors) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"valid":  false,
			"errors": validationErrors,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"valid":   true,
		"message": "Routing rule is valid",
	})
}

// GetRoutingSchema returns the schema for routing conditions
func (h *RoutingHandler) GetRoutingSchema(c *gin.Context) {
	schema := gin.H{
		"operators": []string{
			db.RoutingOperatorEquals,
			db.RoutingOperatorNotEquals,
			db.RoutingOperatorIn,
			db.RoutingOperatorNotIn,
			db.RoutingOperatorContains,
			db.RoutingOperatorNotContains,
			db.RoutingOperatorRegex,
			db.RoutingOperatorGreaterThan,
			db.RoutingOperatorLessThan,
			db.RoutingOperatorDefault,
		},
		"logical_operators": []string{
			db.RoutingLogicalAnd,
			db.RoutingLogicalOr,
			db.RoutingLogicalNot,
		},
		"time_conditions": []string{
			db.TimeConditionBusinessHours,
			db.TimeConditionWeekdays,
			db.TimeConditionWeekends,
			db.TimeConditionHours,
			db.TimeConditionDays,
			db.TimeConditionTimezone,
		},
		"supported_fields": []string{
			"severity",
			"source",
			"labels.*",
			"metadata.*",
			"environment",
		},
		"severity_values": []string{
			"low",
			"medium",
			"high",
			"critical",
		},
		"examples": gin.H{
			"simple_severity": gin.H{
				"severity": "critical",
			},
			"severity_with_operator": gin.H{
				"severity": gin.H{
					"operator": "in",
					"value":    []string{"high", "critical"},
				},
			},
			"source_contains": gin.H{
				"source": gin.H{
					"operator": "contains",
					"value":    "database",
				},
			},
			"complex_and": gin.H{
				"and": []gin.H{
					{"severity": "critical"},
					{"source": gin.H{
						"operator": "contains",
						"value":    "prod",
					}},
					{"labels.team": "platform"},
				},
			},
			"business_hours_only": gin.H{
				"severity": "high",
				"time_conditions": gin.H{
					"business_hours": true,
					"timezone":       "Asia/Ho_Chi_Minh",
				},
			},
			"default_rule": gin.H{
				"default": true,
			},
		},
	}

	c.JSON(http.StatusOK, schema)
}

// ExportRoutingConfig exports routing configuration for backup/migration
func (h *RoutingHandler) ExportRoutingConfig(c *gin.Context) {
	// Get all routing tables with rules
	tables, err := h.RoutingService.ListRoutingTables(false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export routing config"})
		return
	}

	config := gin.H{
		"version":        "1.0",
		"exported_at":    c.GetTime("now"),
		"routing_tables": []gin.H{},
		"total_tables":   len(tables),
		"total_rules":    0,
	}

	totalRules := 0
	tablesWithRules := []gin.H{}

	for _, table := range tables {
		rules, err := h.RoutingService.ListRoutingRules(table.ID, false)
		if err != nil {
			continue
		}

		tableConfig := gin.H{
			"table": table,
			"rules": rules,
		}
		tablesWithRules = append(tablesWithRules, tableConfig)
		totalRules += len(rules)
	}

	config["routing_tables"] = tablesWithRules
	config["total_rules"] = totalRules

	c.Header("Content-Disposition", "attachment; filename=routing-config.json")
	c.JSON(http.StatusOK, config)
}
