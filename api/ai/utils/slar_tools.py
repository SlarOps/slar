import json
import logging

logs = logging.getLogger(__name__)

async def execute_get_incidents(arguments: dict) -> str:
    """Execute the get_incidents tool and return formatted results."""
    try:
        # Comprehensive incident data for testing runbook retrieval
        incidents = [
            {
                "id": "e8b86fa7-9a23-473a-bc1a-ed62224ef4cc",
                "title": "Critical CPU usage detected on production web server 3",
                "description": "CPU usage has been consistently above 90% for the past 8 minutes. Application response time increased significantly. Users reporting slow page loads.",
                "status": "triggered",
                "urgency": "high",
                "severity": "critical",
                "service_name": "Web Server",
                "assigned_to_name": "Alice",
                "created_at": "2025-09-21T14:39:30Z",
                "labels": {
                    "environment": "production",
                    "component": "web-server-3",
                    "metric": "cpu_usage",
                    "threshold": "90%"
                }
            },
            {
                "id": "f9c97fb8-1b34-584b-cd2b-fe73335fg5dd",
                "title": "Database connection timeout errors",
                "description": "Multiple connection timeouts to primary database. Connection pool exhausted. Applications unable to establish new database connections.",
                "status": "acknowledged",
                "urgency": "high",
                "severity": "critical",
                "service_name": "PostgreSQL Database",
                "assigned_to_name": "Bob",
                "created_at": "2025-09-21T15:20:15Z",
                "labels": {
                    "environment": "production",
                    "component": "postgresql-primary",
                    "error_type": "connection_timeout",
                    "pool_status": "exhausted"
                }
            },
            {
                "id": "a1b2c3d4-5e6f-7890-abcd-ef1234567890",
                "title": "High memory usage on API service pods",
                "description": "Memory usage above 85% on multiple API service pods. Several pods have been OOMKilled in the last hour. Service degradation observed.",
                "status": "triggered",
                "urgency": "high",
                "severity": "high",
                "service_name": "API Service",
                "assigned_to_name": "Charlie",
                "created_at": "2025-09-21T16:45:22Z",
                "labels": {
                    "environment": "production",
                    "component": "api-service",
                    "metric": "memory_usage",
                    "oomkilled_count": "3"
                }
            },
            {
                "id": "b2c3d4e5-6f78-9012-bcde-f23456789012",
                "title": "Disk space critical on log storage volume",
                "description": "Disk usage at 95% on /var/log volume. Log rotation appears to have failed. Risk of service disruption if disk becomes full.",
                "status": "triggered",
                "urgency": "high",
                "severity": "high",
                "service_name": "Logging Infrastructure",
                "assigned_to_name": "Diana",
                "created_at": "2025-09-21T17:12:08Z",
                "labels": {
                    "environment": "production",
                    "component": "log-storage",
                    "metric": "disk_usage",
                    "volume": "/var/log",
                    "usage_percent": "95%"
                }
            },
            {
                "id": "c3d4e5f6-7890-1234-cdef-345678901234",
                "title": "High error rate on payment processing service",
                "description": "Error rate increased to 15% on payment processing service. Multiple 500 errors observed. Customer transactions failing.",
                "status": "acknowledged",
                "urgency": "high",
                "severity": "critical",
                "service_name": "Payment Service",
                "assigned_to_name": "Eve",
                "created_at": "2025-09-21T18:30:45Z",
                "labels": {
                    "environment": "production",
                    "component": "payment-service",
                    "error_rate": "15%",
                    "error_type": "5xx_errors"
                }
            },
            {
                "id": "d4e5f6g7-8901-2345-def0-456789012345",
                "title": "Network connectivity issues to external API",
                "description": "Intermittent network timeouts when connecting to external payment gateway API. Connection refused errors observed.",
                "status": "triggered",
                "urgency": "medium",
                "severity": "high",
                "service_name": "External Integration",
                "assigned_to_name": "Frank",
                "created_at": "2025-09-21T19:15:33Z",
                "labels": {
                    "environment": "production",
                    "component": "payment-gateway-integration",
                    "error_type": "network_timeout",
                    "external_service": "payment-gateway"
                }
            },
            {
                "id": "e5f6g7h8-9012-3456-ef01-567890123456",
                "title": "Suspicious login attempts detected",
                "description": "Multiple failed login attempts from unusual IP addresses. Potential brute force attack detected. Security monitoring triggered alerts.",
                "status": "triggered",
                "urgency": "high",
                "severity": "critical",
                "service_name": "Authentication Service",
                "assigned_to_name": "Grace",
                "created_at": "2025-09-21T20:05:17Z",
                "labels": {
                    "environment": "production",
                    "component": "auth-service",
                    "security_event": "brute_force",
                    "failed_attempts": "150",
                    "source_ips": "multiple"
                }
            },
            {
                "id": "f6g7h8i9-0123-4567-f012-678901234567",
                "title": "Application response time degradation",
                "description": "Average response time increased from 200ms to 2.5s. Users experiencing slow page loads. Performance SLA breach detected.",
                "status": "acknowledged",
                "urgency": "medium",
                "severity": "high",
                "service_name": "Web Application",
                "assigned_to_name": "Henry",
                "created_at": "2025-09-21T21:22:41Z",
                "labels": {
                    "environment": "production",
                    "component": "web-app",
                    "metric": "response_time",
                    "current_avg": "2.5s",
                    "baseline_avg": "200ms"
                }
            },
            {
                "id": "g7h8i9j0-1234-5678-g123-789012345678",
                "title": "SSL certificate expiring in 7 days",
                "description": "SSL certificate for main domain expires in 7 days. Automatic renewal failed. Manual intervention required to prevent service disruption.",
                "status": "triggered",
                "urgency": "medium",
                "severity": "medium",
                "service_name": "Certificate Management",
                "assigned_to_name": "Ivy",
                "created_at": "2025-09-21T22:10:55Z",
                "labels": {
                    "environment": "production",
                    "component": "ssl-certificate",
                    "domain": "api.example.com",
                    "expires_in": "7_days",
                    "auto_renewal": "failed"
                }
            },
            {
                "id": "h8i9j0k1-2345-6789-h234-890123456789",
                "title": "Backup job failure for user database",
                "description": "Nightly backup job failed for user database. Last successful backup was 2 days ago. Data protection SLA at risk.",
                "status": "resolved",
                "urgency": "medium",
                "severity": "medium",
                "service_name": "Backup Service",
                "assigned_to_name": "Jack",
                "created_at": "2025-09-20T02:30:12Z",
                "resolved_at": "2025-09-21T08:45:33Z",
                "labels": {
                    "environment": "production",
                    "component": "backup-service",
                    "database": "user_db",
                    "last_success": "2_days_ago",
                    "job_status": "failed"
                }
            }
        ]

        # Return as JSON string so the AI can include it in the response
        return json.dumps(incidents, ensure_ascii=False, indent=2)

    except Exception as e:
        logs.error(f"Error in execute_get_incidents: {e}")
        return f"Lỗi khi lấy danh sách incidents: {str(e)}"


async def get_incidents() -> str:
    """Legacy function - kept for compatibility."""
    return await execute_get_incidents({})