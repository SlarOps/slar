package db

// System User UUIDs for automated actions
// These correspond to system users created in the database
const (
	// SystemUserPrometheus represents Prometheus AlertManager
	SystemUserPrometheus = "00000000-0000-0000-0000-000000000001"
	
	// SystemUserDatadog represents Datadog monitoring
	SystemUserDatadog = "00000000-0000-0000-0000-000000000002"
	
	// SystemUserGrafana represents Grafana alerting
	SystemUserGrafana = "00000000-0000-0000-0000-000000000003"
	
	// SystemUserAWS represents AWS CloudWatch
	SystemUserAWS = "00000000-0000-0000-0000-000000000004"
	
	// SystemUserWebhook represents generic webhook system
	SystemUserWebhook = "00000000-0000-0000-0000-000000000005"
	
	// SystemUserAPI represents API system actions
	SystemUserAPI = "00000000-0000-0000-0000-000000000006"
)

// GetSystemUserBySource returns the appropriate system user ID based on alert source
func GetSystemUserBySource(source string) string {
	switch source {
	case "prometheus":
		return SystemUserPrometheus
	case "datadog":
		return SystemUserDatadog
	case "grafana":
		return SystemUserGrafana
	case "aws", "cloudwatch":
		return SystemUserAWS
	case "webhook":
		return SystemUserWebhook
	case "api":
		return SystemUserAPI
	default:
		return SystemUserWebhook // Default fallback
	}
}
