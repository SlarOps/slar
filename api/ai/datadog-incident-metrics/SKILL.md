---
name: datadog-incident-metrics
description: Query and analyze Datadog metrics during incidents. Use when investigating incidents to quickly retrieve CPU, memory, error rate, and RPS metrics for affected components and generate analysis reports.
---

# Datadog Incident Metrics

## Overview

A skill for querying and analyzing Datadog metrics during incident response. Use this skill to quickly gather performance data, detect anomalies, and generate incident analysis reports with actionable recommendations.

## When to Use This Skill

Use this skill when:
- Investigating active incidents or alerts
- User asks to check Datadog metrics for specific services/components
- Troubleshooting performance issues (high CPU, memory leaks, error spikes, traffic surges)
- Generating incident reports with metrics data
- Analyzing time-series data around incident time windows
- User mentions Datadog, metrics, monitoring, or observability in context of incidents

## Workflow: Two-Step Process

This skill follows a **workflow-based approach** with two sequential steps:

### Step 1: Query Datadog Metrics

**Tool:** `scripts/query_datadog.py`

**Purpose:** Retrieve time-series metrics from Datadog API for specified components

**Command:**
```bash
python scripts/query_datadog.py \
  --components "api-gateway,auth-service,database,redis" \
  --incident-time "2025-01-07 14:30:00" \
  --metrics "cpu,memory,error_rate,rps" \
  --output /tmp/metrics_data.json
```

**Parameters:**
- `--components`: Comma-separated list of service/component names (required)
- `--incident-time`: Incident timestamp or relative time (e.g., "30m ago", "now")
- `--metrics`: Metrics to query (default: "cpu,memory,error_rate,rps")
- `--before`: Minutes before incident (default: 30)
- `--after`: Minutes after incident (default: 30)
- `--output`: Output JSON file path (default: metrics_data.json)

**Supported Metrics:**
- **CPU**: `system.cpu.user`, `container.cpu.usage`, `kubernetes.cpu.usage`
- **Memory**: `system.mem.used`, `container.memory.usage`, `kubernetes.memory.usage`
- **Error Rate**: `trace.*.errors`, `http.status_code.5xx`, `error.count`
- **RPS**: `trace.*.hits`, `http.requests`, `requests.count`

See `references/common_metrics.md` for comprehensive metrics documentation.

### Step 2: Analyze Metrics

**Tool:** `scripts/analyze_metrics.py`

**Purpose:** Process metrics data, detect anomalies, generate markdown report

**Command:**
```bash
python scripts/analyze_metrics.py /tmp/metrics_data.json \
  --output incident_report.md
```

**Analysis Features:**
- Anomaly detection with severity levels (CRITICAL/HIGH/MEDIUM)
- Statistical calculations (min, max, avg, median, stdev)
- Threshold-based alerts:
  - CPU > 80% (CRITICAL), > 60% (HIGH)
  - Memory > 85% (CRITICAL), > 70% (HIGH)
  - Error rate > 5% (CRITICAL), > 1% (HIGH)
  - RPS spikes > 2x median (HIGH)
- Actionable recommendations

**Output:** Markdown report with:
- Incident summary
- Detected anomalies (prioritized by severity)
- Metrics statistics table
- Recommendations based on findings

## Complete Workflow Example

```bash
# Step 1: Query metrics around incident time
python scripts/query_datadog.py \
  --components "api-gateway,auth-service,redis,postgres" \
  --incident-time "30m ago" \
  --before 30 \
  --after 30 \
  --output /tmp/incident_metrics.json

# Step 2: Analyze and generate report
python scripts/analyze_metrics.py /tmp/incident_metrics.json \
  --output incident_analysis_report.md

# Step 3: View report
cat incident_analysis_report.md
```

## Example Interactions

### Scenario 1: Active Incident Investigation

**User:** "We have high CPU on api-gateway, can you check Datadog?"

**Claude Response:**
```
I'll query Datadog metrics for api-gateway around the current time.

[Run query_datadog.py with components="api-gateway", incident-time="now"]
[Run analyze_metrics.py on output]

Analysis complete. Here are the findings:

CRITICAL Issues:
- api-gateway: CPU usage spiked to 92.4% (avg: 85.2%)
- RPS increased to 2,450 req/s (2.5x normal baseline)

Recommendations:
1. Immediate: Scale api-gateway instances to handle load
2. Investigate: Check for traffic spike or inefficient code path
```

### Scenario 2: Post-Incident Report

**User:** "Generate a report for the incident at 2PM yesterday affecting auth-service and database"

**Claude Response:**
```
I'll pull metrics for auth-service and database around 2PM yesterday (2025-01-07 14:00:00).

[Run query_datadog.py with specific incident time]
[Run analyze_metrics.py]

Report generated. Key findings:

HIGH Issues:
- auth-service: Error rate increased to 3.2% (baseline: 0.1%)
- database: Query latency increased 5x during incident window

The detailed report has been saved to incident_analysis_report.md.
```

### Scenario 3: Metrics Reference Question

**User:** "What metrics can I query from Datadog?"

**Claude Response:**
```
[Reference references/common_metrics.md]

Available metrics by category:

CPU Metrics:
- system.cpu.user: User CPU usage
- system.cpu.system: System CPU usage
- container.cpu.usage: Container CPU

Memory Metrics:
- system.mem.used: Used memory
- system.mem.pct_usable: Memory % available
- container.memory.usage: Container memory

[Continue with error_rate and rps metrics...]
```

## Tips for Using This Skill

1. **Always ask for component names** if not provided by user
   - Example: "Which services should I check? (e.g., api-gateway, database, redis)"

2. **Use relative time if specific timestamp not given**
   - "30m ago", "1h ago", "2h ago" are easier than exact timestamps

3. **Default to all metrics** unless user specifies otherwise
   - CPU, memory, error_rate, and rps provide comprehensive view

4. **Present report to user** after generation
   - Read the markdown file and display key findings
   - Highlight CRITICAL and HIGH severity issues first

5. **Reference common_metrics.md** for metric details
   - If user asks about specific metrics, consult `references/common_metrics.md`

6. **Check environment variables** before running scripts
   - Remind user to set DD_API_KEY and DD_APP_KEY if errors occur

## Setup Instructions

### Prerequisites

**Environment Variables Required:**
```bash
export DD_API_KEY="your_datadog_api_key"
export DD_APP_KEY="your_datadog_app_key"
export DD_SITE="datadoghq.eu"  # Optional, default: datadoghq.eu
```

**Get Datadog API Keys:**
1. Login to Datadog
2. Go to Organization Settings > API Keys
3. Create or copy API Key (DD_API_KEY)
4. Go to Organization Settings > Application Keys
5. Create or copy Application Key (DD_APP_KEY)

### Install Dependencies

```bash
cd /Users/chonle/.claude/skills/datadog-incident-metrics
pip install -r requirements.txt
```

Requirements:
- `requests` - HTTP client for Datadog API
- `python-dateutil` - Date parsing

### Make Scripts Executable (Optional)

```bash
chmod +x scripts/*.py
```

## Advanced Usage

### Custom Time Windows

```bash
# Last 15 minutes only
python scripts/query_datadog.py \
  --components "api-gateway" \
  --incident-time "now" \
  --before 15 \
  --after 0

# Extended 2-hour window
python scripts/query_datadog.py \
  --components "database" \
  --incident-time "1h ago" \
  --before 60 \
  --after 60
```

### Specific Metrics Only

```bash
# CPU and memory only
python scripts/query_datadog.py \
  --components "redis,postgres" \
  --metrics "cpu,memory"

# Error rate only
python scripts/query_datadog.py \
  --components "api-gateway" \
  --metrics "error_rate"
```

### Multiple Incidents Comparison

```bash
# Query incident 1
python scripts/query_datadog.py \
  --components "api-gateway" \
  --incident-time "2025-01-07 14:00:00" \
  --output incident1.json

# Query incident 2
python scripts/query_datadog.py \
  --components "api-gateway" \
  --incident-time "2025-01-08 10:00:00" \
  --output incident2.json

# Analyze both
python scripts/analyze_metrics.py incident1.json --output report1.md
python scripts/analyze_metrics.py incident2.json --output report2.md

# Compare reports manually
```

## Troubleshooting

### Error: "Authentication failed"

**Cause:** Invalid or missing DD_API_KEY or DD_APP_KEY

**Solution:**
```bash
# Verify environment variables are set
echo $DD_API_KEY
echo $DD_APP_KEY

# Re-export with correct values
export DD_API_KEY="your_key"
export DD_APP_KEY="your_app_key"
```

### Error: "No data found for component X"

**Cause:** Component name doesn't match Datadog tags or metrics

**Solution:**
- Check exact component name in Datadog UI
- Try common tag formats: `service:api-gateway`, `host:api-gateway-01`
- Consult `references/common_metrics.md` for metric naming conventions

### Error: "API rate limit exceeded"

**Cause:** Too many API requests in short time

**Solution:**
- Wait 60 seconds and retry
- Query fewer components per request
- Reduce time window with `--before` and `--after`

## Resources

### scripts/
Executable Python scripts for querying and analyzing Datadog metrics.

**Files:**
- `query_datadog.py` - Query Datadog API for metrics data
- `analyze_metrics.py` - Analyze metrics and generate incident report

**Usage:** Execute directly with Python. See workflow examples above.

### references/
Documentation and reference material for Datadog metrics.

**Files:**
- `common_metrics.md` - Comprehensive list of common Datadog metrics organized by category (CPU, Memory, Error Rate, RPS, Network, Disk, Database), with query examples and troubleshooting guide

**Usage:** Reference this file when user asks about specific metrics or needs guidance on metric selection.

---

**External Resources:**
- Datadog API Documentation: https://docs.datadoghq.com/api/latest/metrics/
- Datadog Query Syntax: https://docs.datadoghq.com/dashboards/functions/
