datadog webhook payload:
```json
{
    "id": "8306082202796025694",
    "last_updated": "1759343824000",
    "event_type": "query_alert_monitor",
    "title": "[Triggered] High tracking",
    "date": "1759343824000",
    "org": {
        "id": "352347",
        "name": "vng"
    },
    "body": "%%%\nWe get high datadog.event.tracking.intakev2.audit.bytes\nNotify: @webhook-slar\n\n[![Metric Graph](https://p.datadoghq.com/snapshot/view/dd-snapshots-prod/org_352347/2025-10-01/3be6d9318e32a0b89b518edce4c91e4012229fb5.png)](https://app.datadoghq.com/monitors/221164084?from_ts=1759342924000&to_ts=1759344124000&event_id=8306082202796025694&link_source=monitor_notif)\n\n**datadog.event.tracking.intakev2.audit.bytes** over ***** was **> 100.0** on average during the **last 5m**.\n\nThe monitor was last triggered at Wed Oct 01 2025 18:37:04 UTC.\n\n- - -\n\n[[Monitor Status](https://app.datadoghq.com/monitors/221164084?from_ts=1759342924000&to_ts=1759344124000&event_id=8306082202796025694&link_source=monitor_notif)] \u00b7 [[Edit Monitor](https://app.datadoghq.com/monitors/221164084/edit?link_source=monitor_notif)]\n%%%",
    "transition":"Triggered",
    "aggregate":"06ade3da0286048d242ea8e46f521c93",
    "alert_priority":"P1"
}
```

Prometheus webhook payload:
```json
{
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
  ],
  "groupLabels": {
    "alertname": "HighCPUUsage",
    "instance": "prod-web-server-01:9100",
    "service": "web-frontend"
  },
  "commonLabels": {
    "environment": "production",
    "region": "us-east-1",
    "team": "platform",
    "service": "web-frontend",
    "instance": "prod-web-server-01:9100"
  },
  "commonAnnotations": {
    "runbook_base_url": "https://wiki.company.com/runbooks/",
    "escalation_contact": "sre-team@company.com",
    "incident_commander": "john.doe@company.com"
  },
  "externalURL": "http://alertmanager-prod.company.com:9093",
  "version": "4",
  "groupKey": "{environment=\"production\", service=\"web-frontend\"}:{alertname=\"HighCPUUsage\", instance=\"prod-web-server-01:9100\"}"
}
```