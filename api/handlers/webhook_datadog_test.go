package handlers

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProcessDatadogWebhook(t *testing.T) {
	handler := &WebhookHandler{}

	tests := []struct {
		name          string
		payload       string
		expectedAlert ProcessedAlert
		checkFields   []string
	}{
		{
			name: "Triggered Alert with P1 (Critical) priority",
			payload: `{
				"id": "8306077573749414142",
				"last_updated": "1759343584000",
				"event_type": "query_alert_monitor",
				"title": "[P1] [Triggered] High tracking",
				"date": "1759343584000",
				"org": {
					"id": "352347",
					"name": "vng"
				},
				"body": "We get high datadog.event.tracking.intakev2.audit.bytes",
				"transition": "Triggered",
				"alert_priority": "P1"
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "[P1] [Triggered] High tracking",
				Severity:    "critical",
				Status:      "firing",
				Summary:     "We get high datadog.event.tracking.intakev2.audit.bytes",
				Description: "[P1] [Triggered] High tracking",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Triggered Alert with P2 (High) priority",
			payload: `{
				"id": "8306082202796025694",
				"last_updated": "1759343824000",
				"event_type": "query_alert_monitor",
				"title": "[P2] [Triggered] Memory usage alert",
				"date": "1759343824000",
				"org": {
					"id": "352347",
					"name": "vng"
				},
				"body": "Memory usage is above threshold",
				"transition": "Triggered",
				"alert_priority": "P2"
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "[P2] [Triggered] Memory usage alert",
				Severity:    "high",
				Status:      "firing",
				Summary:     "Memory usage is above threshold",
				Description: "[P2] [Triggered] Memory usage alert",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Triggered Alert with P3 (Warning) priority",
			payload: `{
				"id": "8306082202796025695",
				"last_updated": "1759343824000",
				"event_type": "query_alert_monitor",
				"title": "[P3] [Triggered] Disk usage alert",
				"date": "1759343824000",
				"org": {
					"id": "352347",
					"name": "vng"
				},
				"body": "Disk usage is above threshold",
				"transition": "Triggered",
				"alert_priority": "P3"
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "[P3] [Triggered] Disk usage alert",
				Severity:    "warning",
				Status:      "firing",
				Summary:     "Disk usage is above threshold",
				Description: "[P3] [Triggered] Disk usage alert",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Triggered Alert without priority (default to warning)",
			payload: `{
				"id": "8306082202796025696",
				"last_updated": "1759343824000",
				"event_type": "query_alert_monitor",
				"title": "[Triggered] Network alert",
				"date": "1759343824000",
				"org": {
					"id": "352347",
					"name": "vng"
				},
				"body": "Network issue detected",
				"transition": "Triggered"
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "[Triggered] Network alert",
				Severity:    "warning",
				Status:      "firing",
				Summary:     "Network issue detected",
				Description: "[Triggered] Network alert",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Recovered Alert (always info severity)",
			payload: `{
				"id": "8306079182530772649",
				"last_updated": "1759343704000",
				"event_type": "query_alert_monitor",
				"title": "[P1] [Recovered] High tracking",
				"date": "1759343704000",
				"org": {
					"id": "352347",
					"name": "vng"
				},
				"body": "We get high datadog.event.tracking.intakev2.audit.bytes",
				"transition": "Recovered",
				"alert_priority": "P1"
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "[P1] [Recovered] High tracking",
				Severity:    "info",
				Status:      "resolved",
				Summary:     "We get high datadog.event.tracking.intakev2.audit.bytes",
				Description: "[P1] [Recovered] High tracking",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var payload map[string]interface{}
			if err := json.Unmarshal([]byte(tt.payload), &payload); err != nil {
				t.Fatalf("Failed to unmarshal payload: %v", err)
			}

			alerts := handler.processDatadogWebhook(payload)

			if len(alerts) != 1 {
				t.Fatalf("Expected 1 alert, got %d", len(alerts))
			}

			alert := alerts[0]

			// Check specified fields
			for _, field := range tt.checkFields {
				switch field {
				case "AlertName":
					if alert.AlertName != tt.expectedAlert.AlertName {
						t.Errorf("AlertName = %v, want %v", alert.AlertName, tt.expectedAlert.AlertName)
					}
				case "Severity":
					if alert.Severity != tt.expectedAlert.Severity {
						t.Errorf("Severity = %v, want %v", alert.Severity, tt.expectedAlert.Severity)
					}
				case "Status":
					if alert.Status != tt.expectedAlert.Status {
						t.Errorf("Status = %v, want %v", alert.Status, tt.expectedAlert.Status)
					}
				case "Summary":
					if alert.Summary != tt.expectedAlert.Summary {
						t.Errorf("Summary = %v, want %v", alert.Summary, tt.expectedAlert.Summary)
					}
				case "Description":
					if alert.Description != tt.expectedAlert.Description {
						t.Errorf("Description = %v, want %v", alert.Description, tt.expectedAlert.Description)
					}
				}
			}

			// Check Labels
			if alert.Labels["source"] != "datadog" {
				t.Errorf("Labels[source] = %v, want datadog", alert.Labels["source"])
			}
			if alert.Labels["event_id"] != payload["id"] {
				t.Errorf("Labels[event_id] = %v, want %v", alert.Labels["event_id"], payload["id"])
			}
			if alert.Labels["event_type"] != payload["event_type"] {
				t.Errorf("Labels[event_type] = %v, want %v", alert.Labels["event_type"], payload["event_type"])
			}
			// Check alert_priority if present in payload
			if priority, ok := payload["alert_priority"]; ok {
				if alert.Labels["alert_priority"] != priority {
					t.Errorf("Labels[alert_priority] = %v, want %v", alert.Labels["alert_priority"], priority)
				}
			}

			// Check Annotations
			orgMap := payload["org"].(map[string]interface{})
			if alert.Annotations["org_id"] != orgMap["id"] {
				t.Errorf("Annotations[org_id] = %v, want %v", alert.Annotations["org_id"], orgMap["id"])
			}
			if alert.Annotations["org_name"] != orgMap["name"] {
				t.Errorf("Annotations[org_name] = %v, want %v", alert.Annotations["org_name"], orgMap["name"])
			}

			// Check timestamp parsing
			if alert.StartsAt.IsZero() {
				t.Error("StartsAt should not be zero")
			}
		})
	}
}

func TestParseDatadogTimestamp(t *testing.T) {
	tests := []struct {
		name     string
		payload  map[string]interface{}
		expected time.Time
	}{
		{
			name: "Parse from date field",
			payload: map[string]interface{}{
				"date": "1759343584000",
			},
			expected: time.Unix(0, 1759343584000*int64(time.Millisecond)),
		},
		{
			name: "Parse from last_updated field",
			payload: map[string]interface{}{
				"last_updated": "1759343704000",
			},
			expected: time.Unix(0, 1759343704000*int64(time.Millisecond)),
		},
		{
			name: "Prefer date over last_updated",
			payload: map[string]interface{}{
				"date":         "1759343584000",
				"last_updated": "1759343704000",
			},
			expected: time.Unix(0, 1759343584000*int64(time.Millisecond)),
		},
		{
			name:    "Fallback to current time",
			payload: map[string]interface{}{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseDatadogTimestamp(tt.payload)

			if tt.name == "Fallback to current time" {
				// Just check it's not zero
				if result.IsZero() {
					t.Error("Expected non-zero time for fallback")
				}
			} else {
				if !result.Equal(tt.expected) {
					t.Errorf("parseDatadogTimestamp() = %v, want %v", result, tt.expected)
				}
			}
		})
	}
}

func TestMapDatadogPriority(t *testing.T) {
	tests := []struct {
		name     string
		priority string
		expected string
	}{
		{
			name:     "P1 maps to critical",
			priority: "P1",
			expected: "critical",
		},
		{
			name:     "P2 maps to high",
			priority: "P2",
			expected: "high",
		},
		{
			name:     "P3 maps to warning",
			priority: "P3",
			expected: "warning",
		},
		{
			name:     "P4 maps to info",
			priority: "P4",
			expected: "info",
		},
		{
			name:     "Empty priority defaults to warning",
			priority: "",
			expected: "warning",
		},
		{
			name:     "Unknown priority defaults to warning",
			priority: "P5",
			expected: "warning",
		},
		{
			name:     "Lowercase p1 maps to critical",
			priority: "p1",
			expected: "critical",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := mapDatadogPriority(tt.priority)
			if result != tt.expected {
				t.Errorf("mapDatadogPriority(%s) = %v, want %v", tt.priority, result, tt.expected)
			}
		})
	}
}

func TestGetStringFromMapNested(t *testing.T) {
	payload := map[string]interface{}{
		"org": map[string]interface{}{
			"id":   "352347",
			"name": "vng",
		},
		"title": "Test Alert",
	}

	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{
			name:     "Simple field",
			path:     "title",
			expected: "Test Alert",
		},
		{
			name:     "Nested field - org.id",
			path:     "org.id",
			expected: "352347",
		},
		{
			name:     "Nested field - org.name",
			path:     "org.name",
			expected: "vng",
		},
		{
			name:     "Non-existent field",
			path:     "missing",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getStringFromMap(payload, tt.path, "")
			if result != tt.expected {
				t.Errorf("getStringFromMap(%s) = %v, want %v", tt.path, result, tt.expected)
			}
		})
	}
}
