package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type RoutingService struct {
	PG *sql.DB
}

func NewRoutingService(pg *sql.DB) *RoutingService {
	return &RoutingService{PG: pg}
}

// ROUTING TABLE MANAGEMENT

// ListRoutingTables retrieves all routing tables
func (s *RoutingService) ListRoutingTables(activeOnly bool) ([]db.AlertRoutingTable, error) {
	query := `
		SELECT 
			id, name, description, is_active, priority, created_at, updated_at, created_by,
			(SELECT COUNT(*) FROM alert_routing_rules WHERE routing_table_id = art.id AND is_active = true) as rule_count
		FROM alert_routing_tables art
	`
	args := []interface{}{}

	if activeOnly {
		query += " WHERE is_active = true"
	}

	query += " ORDER BY priority DESC, created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []db.AlertRoutingTable
	for rows.Next() {
		var table db.AlertRoutingTable
		var createdBy sql.NullString

		err := rows.Scan(
			&table.ID, &table.Name, &table.Description, &table.IsActive,
			&table.Priority, &table.CreatedAt, &table.UpdatedAt, &createdBy,
			&table.RuleCount,
		)
		if err != nil {
			continue
		}

		if createdBy.Valid {
			table.CreatedBy = createdBy.String
		}

		tables = append(tables, table)
	}

	return tables, nil
}

// GetRoutingTable retrieves a specific routing table
func (s *RoutingService) GetRoutingTable(id string) (*db.AlertRoutingTable, error) {
	var table db.AlertRoutingTable
	var createdBy sql.NullString

	query := `
		SELECT 
			id, name, description, is_active, priority, created_at, updated_at, created_by,
			(SELECT COUNT(*) FROM alert_routing_rules WHERE routing_table_id = $1 AND is_active = true) as rule_count
		FROM alert_routing_tables
		WHERE id = $1
	`

	err := s.PG.QueryRow(query, id).Scan(
		&table.ID, &table.Name, &table.Description, &table.IsActive,
		&table.Priority, &table.CreatedAt, &table.UpdatedAt, &createdBy,
		&table.RuleCount,
	)

	if err != nil {
		return nil, err
	}

	if createdBy.Valid {
		table.CreatedBy = createdBy.String
	}

	return &table, nil
}

// GetRoutingTableWithRules retrieves a routing table with all its rules
func (s *RoutingService) GetRoutingTableWithRules(id string) (*db.RoutingTableWithRules, error) {
	table, err := s.GetRoutingTable(id)
	if err != nil {
		return nil, err
	}

	rules, err := s.ListRoutingRules(id, false)
	if err != nil {
		return nil, err
	}

	return &db.RoutingTableWithRules{
		AlertRoutingTable: *table,
		Rules:             rules,
	}, nil
}

// CreateRoutingTable creates a new routing table
func (s *RoutingService) CreateRoutingTable(req db.CreateRoutingTableRequest, createdBy string) (*db.AlertRoutingTable, error) {
	id := uuid.New().String()
	now := time.Now()

	priority := req.Priority
	if priority == 0 {
		priority = 50 // Default priority
	}

	var createdByParam interface{}
	if createdBy != "" {
		createdByParam = createdBy
	} else {
		createdByParam = nil
	}

	_, err := s.PG.Exec(`
		INSERT INTO alert_routing_tables (id, name, description, priority, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, id, req.Name, req.Description, priority, now, now, createdByParam)

	if err != nil {
		return nil, err
	}

	return s.GetRoutingTable(id)
}

// UpdateRoutingTable updates an existing routing table
func (s *RoutingService) UpdateRoutingTable(id string, req db.UpdateRoutingTableRequest) (*db.AlertRoutingTable, error) {
	setParts := []string{}
	args := []interface{}{}
	argIndex := 1

	if req.Name != nil {
		setParts = append(setParts, fmt.Sprintf("name = $%d", argIndex))
		args = append(args, *req.Name)
		argIndex++
	}

	if req.Description != nil {
		setParts = append(setParts, fmt.Sprintf("description = $%d", argIndex))
		args = append(args, *req.Description)
		argIndex++
	}

	if req.IsActive != nil {
		setParts = append(setParts, fmt.Sprintf("is_active = $%d", argIndex))
		args = append(args, *req.IsActive)
		argIndex++
	}

	if req.Priority != nil {
		setParts = append(setParts, fmt.Sprintf("priority = $%d", argIndex))
		args = append(args, *req.Priority)
		argIndex++
	}

	if len(setParts) == 0 {
		return s.GetRoutingTable(id)
	}

	setParts = append(setParts, fmt.Sprintf("updated_at = $%d", argIndex))
	args = append(args, time.Now())
	argIndex++

	query := fmt.Sprintf("UPDATE alert_routing_tables SET %s WHERE id = $%d", strings.Join(setParts, ", "), argIndex)
	args = append(args, id)

	_, err := s.PG.Exec(query, args...)
	if err != nil {
		return nil, err
	}

	return s.GetRoutingTable(id)
}

// DeleteRoutingTable soft deletes a routing table
func (s *RoutingService) DeleteRoutingTable(id string) error {
	_, err := s.PG.Exec("UPDATE alert_routing_tables SET is_active = false, updated_at = $1 WHERE id = $2", time.Now(), id)
	return err
}

// ROUTING RULES MANAGEMENT

// ListRoutingRules retrieves all rules for a routing table
func (s *RoutingService) ListRoutingRules(tableID string, activeOnly bool) ([]db.AlertRoutingRule, error) {
	query := `
		SELECT 
			arr.id, arr.routing_table_id, arr.name, arr.priority, arr.is_active,
			arr.match_conditions, arr.target_group_id, arr.escalation_rule_id, arr.time_conditions,
			arr.created_at, arr.updated_at, arr.created_by,
			g.name as group_name,
			COALESCE(er.name, '') as escalation_rule_name
		FROM alert_routing_rules arr
		LEFT JOIN groups g ON arr.target_group_id = g.id
		LEFT JOIN escalation_rules er ON arr.escalation_rule_id = er.id
		WHERE arr.routing_table_id = $1
	`
	args := []interface{}{tableID}

	if activeOnly {
		query += " AND arr.is_active = true"
	}

	query += " ORDER BY arr.priority DESC, arr.created_at ASC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []db.AlertRoutingRule
	for rows.Next() {
		var rule db.AlertRoutingRule
		var matchConditionsJSON, timeConditionsJSON []byte
		var createdBy, escalationRuleID sql.NullString
		var groupName, escalationRuleName sql.NullString

		err := rows.Scan(
			&rule.ID, &rule.RoutingTableID, &rule.Name, &rule.Priority, &rule.IsActive,
			&matchConditionsJSON, &rule.TargetGroupID, &escalationRuleID, &timeConditionsJSON,
			&rule.CreatedAt, &rule.UpdatedAt, &createdBy,
			&groupName, &escalationRuleName,
		)
		if err != nil {
			continue
		}

		// Parse JSON fields
		if len(matchConditionsJSON) > 0 {
			json.Unmarshal(matchConditionsJSON, &rule.MatchConditions)
		}
		if len(timeConditionsJSON) > 0 {
			json.Unmarshal(timeConditionsJSON, &rule.TimeConditions)
		}

		if escalationRuleID.Valid {
			rule.EscalationRuleID = escalationRuleID.String
		}
		if createdBy.Valid {
			rule.CreatedBy = createdBy.String
		}
		if groupName.Valid {
			rule.TargetGroupName = groupName.String
		}
		if escalationRuleName.Valid {
			rule.EscalationRuleName = escalationRuleName.String
		}

		rules = append(rules, rule)
	}

	return rules, nil
}

// CreateRoutingRule creates a new routing rule
func (s *RoutingService) CreateRoutingRule(tableID string, req db.CreateRoutingRuleRequest, createdBy string) (*db.AlertRoutingRule, error) {
	id := uuid.New().String()
	now := time.Now()

	priority := req.Priority
	if priority == 0 {
		priority = 50 // Default priority
	}

	matchConditionsJSON, err := json.Marshal(req.MatchConditions)
	if err != nil {
		return nil, fmt.Errorf("invalid match_conditions: %w", err)
	}

	var timeConditionsJSON []byte
	if req.TimeConditions != nil {
		timeConditionsJSON, err = json.Marshal(req.TimeConditions)
		if err != nil {
			return nil, fmt.Errorf("invalid time_conditions: %w", err)
		}
	}

	var createdByParam interface{}
	if createdBy != "" {
		createdByParam = createdBy
	} else {
		createdByParam = nil
	}

	var escalationRuleParam interface{}
	if req.EscalationRuleID != "" {
		escalationRuleParam = req.EscalationRuleID
	} else {
		escalationRuleParam = nil
	}

	_, err = s.PG.Exec(`
		INSERT INTO alert_routing_rules 
		(id, routing_table_id, name, priority, match_conditions, target_group_id, escalation_rule_id, time_conditions, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, id, tableID, req.Name, priority, matchConditionsJSON, req.TargetGroupID, escalationRuleParam, timeConditionsJSON, now, now, createdByParam)

	if err != nil {
		return nil, err
	}

	return s.GetRoutingRule(id)
}

// GetRoutingRule retrieves a specific routing rule
func (s *RoutingService) GetRoutingRule(id string) (*db.AlertRoutingRule, error) {
	var rule db.AlertRoutingRule
	var matchConditionsJSON, timeConditionsJSON []byte
	var createdBy, escalationRuleID sql.NullString
	var groupName, escalationRuleName sql.NullString

	query := `
		SELECT 
			arr.id, arr.routing_table_id, arr.name, arr.priority, arr.is_active,
			arr.match_conditions, arr.target_group_id, arr.escalation_rule_id, arr.time_conditions,
			arr.created_at, arr.updated_at, arr.created_by,
			g.name as group_name,
			COALESCE(er.name, '') as escalation_rule_name
		FROM alert_routing_rules arr
		LEFT JOIN groups g ON arr.target_group_id = g.id
		LEFT JOIN escalation_rules er ON arr.escalation_rule_id = er.id
		WHERE arr.id = $1
	`

	err := s.PG.QueryRow(query, id).Scan(
		&rule.ID, &rule.RoutingTableID, &rule.Name, &rule.Priority, &rule.IsActive,
		&matchConditionsJSON, &rule.TargetGroupID, &escalationRuleID, &timeConditionsJSON,
		&rule.CreatedAt, &rule.UpdatedAt, &createdBy,
		&groupName, &escalationRuleName,
	)

	if err != nil {
		return nil, err
	}

	// Parse JSON fields
	if len(matchConditionsJSON) > 0 {
		json.Unmarshal(matchConditionsJSON, &rule.MatchConditions)
	}
	if len(timeConditionsJSON) > 0 {
		json.Unmarshal(timeConditionsJSON, &rule.TimeConditions)
	}

	if escalationRuleID.Valid {
		rule.EscalationRuleID = escalationRuleID.String
	}
	if createdBy.Valid {
		rule.CreatedBy = createdBy.String
	}
	if groupName.Valid {
		rule.TargetGroupName = groupName.String
	}
	if escalationRuleName.Valid {
		rule.EscalationRuleName = escalationRuleName.String
	}

	return &rule, nil
}

// ROUTING ENGINE - CORE LOGIC

// RouteAlert evaluates routing tables and returns routing result
func (s *RoutingService) RouteAlert(alert *db.Alert) (*db.RoutingResult, error) {
	startTime := time.Now()

	// Convert alert to attributes for evaluation
	alertAttrs := s.convertAlertToAttributes(alert)

	// Get all active routing tables (sorted by priority)
	tables, err := s.getActiveRoutingTablesForEvaluation()
	if err != nil {
		return nil, fmt.Errorf("failed to get routing tables: %w", err)
	}

	// Evaluate tables in priority order
	for _, table := range tables {
		rules, err := s.getActiveRulesForTable(table.ID)
		if err != nil {
			continue
		}

		// Evaluate rules in priority order
		for _, rule := range rules {
			if s.evaluateRule(alertAttrs, &rule) {
				evaluationTime := int(time.Since(startTime).Milliseconds())

				// Log the match
				s.logRouteMatch(alert.ID, &table, &rule, alertAttrs, evaluationTime)

				return &db.RoutingResult{
					TargetGroupID:    rule.TargetGroupID,
					EscalationRuleID: rule.EscalationRuleID,
					MatchedRule:      &rule,
					MatchedTable:     &table,
					MatchedReason:    fmt.Sprintf("Matched rule '%s' in table '%s'", rule.Name, table.Name),
					EvaluationTimeMs: evaluationTime,
				}, nil
			}
		}
	}

	// No match found - return error or default
	return nil, fmt.Errorf("no routing rule matched for alert: %s", alert.ID)
}

// TestRouting tests routing for given alert attributes without creating logs
func (s *RoutingService) TestRouting(attrs db.AlertAttributes) (*db.RoutingResult, error) {
	startTime := time.Now()

	// Get all active routing tables (sorted by priority)
	tables, err := s.getActiveRoutingTablesForEvaluation()
	if err != nil {
		return nil, fmt.Errorf("failed to get routing tables: %w", err)
	}

	// Evaluate tables in priority order
	for _, table := range tables {
		rules, err := s.getActiveRulesForTable(table.ID)
		if err != nil {
			continue
		}

		// Evaluate rules in priority order
		for _, rule := range rules {
			if s.evaluateRule(attrs, &rule) {
				evaluationTime := int(time.Since(startTime).Milliseconds())

				return &db.RoutingResult{
					TargetGroupID:    rule.TargetGroupID,
					EscalationRuleID: rule.EscalationRuleID,
					MatchedRule:      &rule,
					MatchedTable:     &table,
					MatchedReason:    fmt.Sprintf("Would match rule '%s' in table '%s'", rule.Name, table.Name),
					EvaluationTimeMs: evaluationTime,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("no routing rule would match for given attributes")
}

// INTERNAL HELPER METHODS

// convertAlertToAttributes converts alert to attributes for evaluation
func (s *RoutingService) convertAlertToAttributes(alert *db.Alert) db.AlertAttributes {
	attrs := db.AlertAttributes{
		Severity:  alert.Severity,
		Source:    alert.Source,
		CreatedAt: &alert.CreatedAt,
	}

	// Add metadata and labels if available (would need to extend Alert model)
	// For now, we'll use basic attributes

	return attrs
}

// getActiveRoutingTablesForEvaluation gets active routing tables sorted by priority
func (s *RoutingService) getActiveRoutingTablesForEvaluation() ([]db.AlertRoutingTable, error) {
	query := `
		SELECT id, name, description, is_active, priority, created_at, updated_at, created_by
		FROM alert_routing_tables 
		WHERE is_active = true 
		ORDER BY priority DESC, created_at ASC
	`

	rows, err := s.PG.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []db.AlertRoutingTable
	for rows.Next() {
		var table db.AlertRoutingTable
		var createdBy sql.NullString

		err := rows.Scan(
			&table.ID, &table.Name, &table.Description, &table.IsActive,
			&table.Priority, &table.CreatedAt, &table.UpdatedAt, &createdBy,
		)
		if err != nil {
			continue
		}

		if createdBy.Valid {
			table.CreatedBy = createdBy.String
		}

		tables = append(tables, table)
	}

	return tables, nil
}

// getActiveRulesForTable gets active rules for a table sorted by priority
func (s *RoutingService) getActiveRulesForTable(tableID string) ([]db.AlertRoutingRule, error) {
	return s.ListRoutingRules(tableID, true)
}

// evaluateRule evaluates if alert attributes match a routing rule
func (s *RoutingService) evaluateRule(attrs db.AlertAttributes, rule *db.AlertRoutingRule) bool {
	// First check time conditions
	if !s.evaluateTimeConditions(rule.TimeConditions) {
		return false
	}

	// Then check match conditions
	return s.evaluateMatchConditions(attrs, rule.MatchConditions)
}

// evaluateTimeConditions evaluates time-based conditions
func (s *RoutingService) evaluateTimeConditions(timeConditions map[string]interface{}) bool {
	if timeConditions == nil || len(timeConditions) == 0 {
		return true // No time conditions means always match
	}

	now := time.Now()

	// Business hours check
	if businessHours, ok := timeConditions[db.TimeConditionBusinessHours]; ok {
		if bh, ok := businessHours.(bool); ok && bh {
			hour := now.Hour()
			weekday := now.Weekday()
			// Simple business hours: 9-17, Mon-Fri
			if weekday == time.Saturday || weekday == time.Sunday || hour < 9 || hour >= 17 {
				return false
			}
		}
	}

	// Add more time condition evaluations as needed
	return true
}

// evaluateMatchConditions evaluates match conditions against alert attributes
func (s *RoutingService) evaluateMatchConditions(attrs db.AlertAttributes, conditions map[string]interface{}) bool {
	for key, value := range conditions {
		switch key {
		case "severity":
			if !s.matchSeverity(attrs.Severity, value) {
				return false
			}
		case "source":
			if !s.matchSource(attrs.Source, value) {
				return false
			}
		case "and":
			if !s.evaluateAndConditions(attrs, value) {
				return false
			}
		case "or":
			if !s.evaluateOrConditions(attrs, value) {
				return false
			}
		case "default":
			return true // Default rule always matches
		default:
			// Handle labels.* or custom attributes
			if !s.matchCustomAttribute(attrs, key, value) {
				return false
			}
		}
	}
	return true
}

// matchSeverity matches severity with operator support
func (s *RoutingService) matchSeverity(alertSeverity string, condition interface{}) bool {
	switch v := condition.(type) {
	case string:
		return alertSeverity == v
	case []interface{}:
		for _, item := range v {
			if str, ok := item.(string); ok && alertSeverity == str {
				return true
			}
		}
		return false
	case map[string]interface{}:
		if operator, ok := v["operator"].(string); ok {
			value := v["value"]
			switch operator {
			case db.RoutingOperatorEquals:
				if str, ok := value.(string); ok {
					return alertSeverity == str
				}
			case db.RoutingOperatorIn:
				if arr, ok := value.([]interface{}); ok {
					for _, item := range arr {
						if str, ok := item.(string); ok && alertSeverity == str {
							return true
						}
					}
				}
			}
		}
	}
	return false
}

// matchSource matches source field
func (s *RoutingService) matchSource(alertSource string, condition interface{}) bool {
	switch v := condition.(type) {
	case string:
		return alertSource == v
	case map[string]interface{}:
		if operator, ok := v["operator"].(string); ok {
			value := v["value"]
			switch operator {
			case db.RoutingOperatorEquals:
				if str, ok := value.(string); ok {
					return alertSource == str
				}
			case db.RoutingOperatorContains:
				if str, ok := value.(string); ok {
					return strings.Contains(alertSource, str)
				}
			case db.RoutingOperatorRegex:
				if str, ok := value.(string); ok {
					if matched, err := regexp.MatchString(str, alertSource); err == nil {
						return matched
					}
				}
			}
		}
	}
	return false
}

// evaluateAndConditions evaluates AND logical operator
func (s *RoutingService) evaluateAndConditions(attrs db.AlertAttributes, condition interface{}) bool {
	if arr, ok := condition.([]interface{}); ok {
		for _, item := range arr {
			if condMap, ok := item.(map[string]interface{}); ok {
				if !s.evaluateMatchConditions(attrs, condMap) {
					return false
				}
			}
		}
		return true
	}
	return false
}

// evaluateOrConditions evaluates OR logical operator
func (s *RoutingService) evaluateOrConditions(attrs db.AlertAttributes, condition interface{}) bool {
	if arr, ok := condition.([]interface{}); ok {
		for _, item := range arr {
			if condMap, ok := item.(map[string]interface{}); ok {
				if s.evaluateMatchConditions(attrs, condMap) {
					return true
				}
			}
		}
	}
	return false
}

// matchCustomAttribute matches custom attributes like labels
func (s *RoutingService) matchCustomAttribute(attrs db.AlertAttributes, key string, condition interface{}) bool {
	// Handle labels.* patterns
	if strings.HasPrefix(key, "labels.") {
		labelKey := strings.TrimPrefix(key, "labels.")
		if attrs.Labels != nil {
			if labelValue, exists := attrs.Labels[labelKey]; exists {
				return s.matchValue(labelValue, condition)
			}
		}
		return false
	}

	// Handle metadata.* patterns
	if strings.HasPrefix(key, "metadata.") {
		metadataKey := strings.TrimPrefix(key, "metadata.")
		if attrs.Metadata != nil {
			if metadataValue, exists := attrs.Metadata[metadataKey]; exists {
				return s.matchValue(metadataValue, condition)
			}
		}
		return false
	}

	// Handle environment
	if key == "environment" {
		return s.matchValue(attrs.Environment, condition)
	}

	return false
}

// matchValue is a generic value matcher
func (s *RoutingService) matchValue(actualValue interface{}, condition interface{}) bool {
	switch v := condition.(type) {
	case string:
		return fmt.Sprintf("%v", actualValue) == v
	case map[string]interface{}:
		if operator, ok := v["operator"].(string); ok {
			expectedValue := v["value"]
			actualStr := fmt.Sprintf("%v", actualValue)
			expectedStr := fmt.Sprintf("%v", expectedValue)

			switch operator {
			case db.RoutingOperatorEquals:
				return actualStr == expectedStr
			case db.RoutingOperatorNotEquals:
				return actualStr != expectedStr
			case db.RoutingOperatorContains:
				return strings.Contains(actualStr, expectedStr)
			case db.RoutingOperatorRegex:
				if matched, err := regexp.MatchString(expectedStr, actualStr); err == nil {
					return matched
				}
			case db.RoutingOperatorIn:
				if arr, ok := expectedValue.([]interface{}); ok {
					for _, item := range arr {
						if fmt.Sprintf("%v", item) == actualStr {
							return true
						}
					}
				}
			}
		}
	}
	return false
}

// logRouteMatch logs a routing decision
func (s *RoutingService) logRouteMatch(alertID string, table *db.AlertRoutingTable, rule *db.AlertRoutingRule, attrs db.AlertAttributes, evaluationTimeMs int) {
	id := uuid.New().String()
	now := time.Now()

	matchConditionsJSON, _ := json.Marshal(rule.MatchConditions)
	alertAttributesJSON, _ := json.Marshal(attrs)

	reason := fmt.Sprintf("Matched rule '%s' in table '%s' (priority %d)", rule.Name, table.Name, rule.Priority)

	_, err := s.PG.Exec(`
		INSERT INTO alert_route_logs 
		(id, alert_id, routing_table_id, routing_rule_id, target_group_id, matched_at, matched_reason, match_conditions, alert_attributes, evaluation_time_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, id, alertID, table.ID, rule.ID, rule.TargetGroupID, now, reason, matchConditionsJSON, alertAttributesJSON, evaluationTimeMs)

	if err != nil {
		fmt.Printf("Failed to log route match: %v\n", err)
	}
}

// GetRoutingHistory retrieves routing history for an alert
func (s *RoutingService) GetRoutingHistory(alertID string) ([]db.AlertRouteLog, error) {
	query := `
		SELECT 
			arl.id, arl.alert_id, arl.routing_table_id, arl.routing_rule_id, arl.target_group_id,
			arl.matched_at, arl.matched_reason, arl.match_conditions, arl.alert_attributes, arl.evaluation_time_ms,
			art.name as routing_table_name,
			arr.name as routing_rule_name,
			g.name as target_group_name
		FROM alert_route_logs arl
		LEFT JOIN alert_routing_tables art ON arl.routing_table_id = art.id
		LEFT JOIN alert_routing_rules arr ON arl.routing_rule_id = arr.id
		LEFT JOIN groups g ON arl.target_group_id = g.id
		WHERE arl.alert_id = $1
		ORDER BY arl.matched_at DESC
	`

	rows, err := s.PG.Query(query, alertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []db.AlertRouteLog
	for rows.Next() {
		var log db.AlertRouteLog
		var routingTableID, routingRuleID, targetGroupID sql.NullString
		var routingTableName, routingRuleName, targetGroupName sql.NullString
		var matchConditionsJSON, alertAttributesJSON []byte

		err := rows.Scan(
			&log.ID, &log.AlertID, &routingTableID, &routingRuleID, &targetGroupID,
			&log.MatchedAt, &log.MatchedReason, &matchConditionsJSON, &alertAttributesJSON, &log.EvaluationTimeMs,
			&routingTableName, &routingRuleName, &targetGroupName,
		)
		if err != nil {
			continue
		}

		if routingTableID.Valid {
			log.RoutingTableID = routingTableID.String
		}
		if routingRuleID.Valid {
			log.RoutingRuleID = routingRuleID.String
		}
		if targetGroupID.Valid {
			log.TargetGroupID = targetGroupID.String
		}
		if routingTableName.Valid {
			log.RoutingTableName = routingTableName.String
		}
		if routingRuleName.Valid {
			log.RoutingRuleName = routingRuleName.String
		}
		if targetGroupName.Valid {
			log.TargetGroupName = targetGroupName.String
		}

		// Parse JSON fields
		if len(matchConditionsJSON) > 0 {
			json.Unmarshal(matchConditionsJSON, &log.MatchConditions)
		}
		if len(alertAttributesJSON) > 0 {
			json.Unmarshal(alertAttributesJSON, &log.AlertAttributes)
		}

		logs = append(logs, log)
	}

	return logs, nil
}
