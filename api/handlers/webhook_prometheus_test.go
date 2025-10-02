package handlers

import (
	"encoding/json"
	"testing"
)

func TestProcessPrometheusWebhook(t *testing.T) {
	handler := &WebhookHandler{}

	tests := []struct {
		name          string
		payload       string
		expectedAlert ProcessedAlert
		checkFields   []string
	}{
		{
			name: "Firing Alert with Critical severity",
			payload: `{
				"receiver": "slar-webhook",
				"status": "firing",
				"alerts": [
					{
						"status": "firing",
						"labels": {
							"alertname": "HighCPUUsage",
							"instance": "prod-web-server-01:9100",
							"job": "node-exporter",
							"severity": "critical",
							"service": "web-frontend",
							"environment": "production",
							"region": "us-east-1",
							"availability_zone": "us-east-1a",
							"team": "platform",
							"application": "ecommerce-frontend",
							"cluster": "prod-k8s-cluster",
							"namespace": "default",
							"pod": "web-frontend-deployment-7d8f9c6b5d-x4m2p",
							"container": "nginx",
							"node": "ip-10-0-1-45.ec2.internal"
						},
						"annotations": {
							"summary": "Critical CPU usage detected on production web server 3",
							"description": "CPU usage has been consistently above 90% for the past 8 minutes on prod-web-server-01. Current usage: 94.7%. This may impact user experience and cause service degradation. Immediate investigation required.",
							"runbook_url": "https://wiki.company.com/runbooks/high-cpu-usage",
							"dashboard_url": "https://grafana.company.com/d/node-exporter/node-exporter?var-instance=prod-web-server-01:9100",
							"impact": "High - May cause slow response times and potential service unavailability",
							"suggested_actions": "1. Check for resource-intensive processes 2. Scale horizontally if needed 3. Investigate memory leaks 4. Review recent deployments",
							"escalation_policy": "Page SRE team if not resolved within 15 minutes",
							"business_impact": "Customer checkout process may be affected, potential revenue loss",
							"affected_users": "~5000 active users on this server instance"
						},
						"startsAt": "2024-01-15T10:30:00.000Z",
						"endsAt": "0001-01-01T00:00:00Z",
						"generatorURL": "http://prometheus:9090/graph?g0.expr=100%20-%20(avg%20by%20(instance)%20(rate(node_cpu_seconds_total%7Bmode%3D%22idle%22%7D%5B5m%5D))%20*%20100)%20%3E%2090",
						"fingerprint": "7c7c4ce9f8a2b1d"
					}
				]
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "HighCPUUsage",
				Severity:    "critical",
				Status:      "firing",
				Summary:     "Critical CPU usage detected on production web server 3",
				Description: "CPU usage has been consistently above 90% for the past 8 minutes on prod-web-server-01. Current usage: 94.7%. This may impact user experience and cause service degradation. Immediate investigation required.",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Firing Alert with Warning severity",
			payload: `{
				"receiver": "slar-webhook",
				"status": "firing",
				"alerts": [
					{
						"status": "firing",
						"labels": {
							"alertname": "HighMemoryUsage",
							"instance": "prod-web-server-02:9100",
							"job": "node-exporter",
							"severity": "warning"
						},
						"annotations": {
							"summary": "Memory usage is high",
							"description": "Memory usage is above 80%"
						},
						"startsAt": "2024-01-15T11:00:00.000Z",
						"endsAt": "0001-01-01T00:00:00Z",
						"fingerprint": "abc123def456"
					}
				]
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "HighMemoryUsage",
				Severity:    "warning",
				Status:      "firing",
				Summary:     "Memory usage is high",
				Description: "Memory usage is above 80%",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Resolved Alert",
			payload: `{
				"receiver": "slar-webhook",
				"status": "resolved",
				"alerts": [
					{
						"status": "resolved",
						"labels": {
							"alertname": "HighCPUUsage",
							"instance": "prod-web-server-01:9100",
							"job": "node-exporter",
							"severity": "critical"
						},
						"annotations": {
							"summary": "CPU usage is back to normal",
							"description": "CPU usage has dropped below threshold"
						},
						"startsAt": "2024-01-15T10:30:00.000Z",
						"endsAt": "2024-01-15T10:45:00.000Z",
						"fingerprint": "7c7c4ce9f8a2b1d"
					}
				]
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "HighCPUUsage",
				Severity:    "critical",
				Status:      "resolved",
				Summary:     "CPU usage is back to normal",
				Description: "CPU usage has dropped below threshold",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Alert without severity (default to warning)",
			payload: `{
				"receiver": "slar-webhook",
				"status": "firing",
				"alerts": [
					{
						"status": "firing",
						"labels": {
							"alertname": "DiskSpaceLow",
							"instance": "prod-db-server-01:9100",
							"job": "node-exporter"
						},
						"annotations": {
							"summary": "Disk space is running low",
							"description": "Less than 10% disk space remaining"
						},
						"startsAt": "2024-01-15T12:00:00.000Z",
						"endsAt": "0001-01-01T00:00:00Z",
						"fingerprint": "xyz789"
						}
				]
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "DiskSpaceLow",
				Severity:    "warning",
				Status:      "firing",
				Summary:     "Disk space is running low",
				Description: "Less than 10% disk space remaining",
			},
			checkFields: []string{"AlertName", "Severity", "Status", "Summary", "Description"},
		},
		{
			name: "Alert without fingerprint (should generate one)",
			payload: `{
				"receiver": "slar-webhook",
				"status": "firing",
				"alerts": [
					{
						"status": "firing",
						"labels": {
							"alertname": "ServiceDown",
							"instance": "prod-api-server-01:8080",
							"job": "api-service",
							"severity": "critical"
						},
						"annotations": {
							"summary": "API service is down",
							"description": "API service is not responding"
						},
						"startsAt": "2024-01-15T13:00:00.000Z",
						"endsAt": "0001-01-01T00:00:00Z"
					}
				]
			}`,
			expectedAlert: ProcessedAlert{
				AlertName:   "ServiceDown",
				Severity:    "critical",
				Status:      "firing",
				Summary:     "API service is down",
				Description: "API service is not responding",
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

			alerts := handler.processPrometheusWebhook(payload)

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

			// Check Labels - extract from payload
			alertsArray := payload["alerts"].([]interface{})
			firstAlert := alertsArray[0].(map[string]interface{})
			labels := firstAlert["labels"].(map[string]interface{})

			if alertname, ok := labels["alertname"].(string); ok {
				if alert.AlertName != alertname {
					t.Errorf("AlertName from labels = %v, want %v", alert.AlertName, alertname)
				}
			}

			if severity, ok := labels["severity"].(string); ok {
				if alert.Severity != severity {
					t.Errorf("Severity from labels = %v, want %v", alert.Severity, severity)
				}
			}

			// Check Fingerprint
			if fingerprint, ok := firstAlert["fingerprint"].(string); ok {
				if alert.Fingerprint != fingerprint {
					t.Errorf("Fingerprint = %v, want %v", alert.Fingerprint, fingerprint)
				}
			} else {
				// Should generate fingerprint from labels
				if alert.Fingerprint == "" {
					t.Error("Fingerprint should be generated when not provided")
				}
			}

			// Check timestamp parsing
			if alert.StartsAt.IsZero() {
				t.Error("StartsAt should not be zero")
			}
		})
	}
}

