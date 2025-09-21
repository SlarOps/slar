package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

type DebugHandler struct {
	PG *sql.DB
}

func NewDebugHandler(pg *sql.DB) *DebugHandler {
	return &DebugHandler{PG: pg}
}

// CheckRotationTables checks if rotation-related tables and functions exist
func (h *DebugHandler) CheckRotationTables(c *gin.Context) {
	result := map[string]interface{}{
		"timestamp": "2025-01-24",
	}

	// Check if rotation_cycles table exists
	var tableExists bool
	err := h.PG.QueryRow(`
		SELECT EXISTS (
			SELECT FROM information_schema.tables 
			WHERE table_schema = 'public' 
			AND table_name = 'rotation_cycles'
		)
	`).Scan(&tableExists)

	if err != nil {
		result["rotation_cycles_table"] = map[string]interface{}{
			"exists": false,
			"error":  err.Error(),
		}
	} else {
		result["rotation_cycles_table"] = map[string]interface{}{
			"exists": tableExists,
		}

		// If table exists, get column info
		if tableExists {
			rows, err := h.PG.Query(`
				SELECT column_name, data_type, is_nullable 
				FROM information_schema.columns 
				WHERE table_name = 'rotation_cycles' 
				ORDER BY ordinal_position
			`)

			if err != nil {
				result["rotation_cycles_columns"] = map[string]interface{}{
					"error": err.Error(),
				}
			} else {
				defer rows.Close()
				columns := []map[string]interface{}{}

				for rows.Next() {
					var columnName, dataType, isNullable string
					if err := rows.Scan(&columnName, &dataType, &isNullable); err == nil {
						columns = append(columns, map[string]interface{}{
							"name":     columnName,
							"type":     dataType,
							"nullable": isNullable,
						})
					}
				}
				result["rotation_cycles_columns"] = columns
			}
		}
	}

	// Check if generate_rotation_schedules function exists
	var functionExists bool
	err = h.PG.QueryRow(`
		SELECT EXISTS (
			SELECT FROM information_schema.routines 
			WHERE routine_schema = 'public' 
			AND routine_name = 'generate_rotation_schedules'
		)
	`).Scan(&functionExists)

	if err != nil {
		result["generate_rotation_schedules_function"] = map[string]interface{}{
			"exists": false,
			"error":  err.Error(),
		}
	} else {
		result["generate_rotation_schedules_function"] = map[string]interface{}{
			"exists": functionExists,
		}
	}

	// Check oncall_schedules table new columns
	rows, err := h.PG.Query(`
		SELECT column_name, data_type 
		FROM information_schema.columns 
		WHERE table_name = 'oncall_schedules' 
		AND column_name IN ('rotation_cycle_id', 'is_override', 'original_user_id', 'override_reason')
		ORDER BY column_name
	`)

	if err != nil {
		result["oncall_schedules_new_columns"] = map[string]interface{}{
			"error": err.Error(),
		}
	} else {
		defer rows.Close()
		newColumns := []map[string]interface{}{}

		for rows.Next() {
			var columnName, dataType string
			if err := rows.Scan(&columnName, &dataType); err == nil {
				newColumns = append(newColumns, map[string]interface{}{
					"name": columnName,
					"type": dataType,
				})
			}
		}
		result["oncall_schedules_new_columns"] = newColumns
	}

	// Test a simple rotation cycle creation (dry run)
	result["test_rotation_creation"] = "TODO: Add test rotation cycle creation"

	c.JSON(http.StatusOK, result)
}
