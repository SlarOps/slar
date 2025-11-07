# Datadog Incident Metrics Skill - Work In Progress

## Objective
Tạo một Claude skill để query và phân tích Datadog metrics khi có incident, thay vì dùng MCP. Skill sẽ giúp nhanh chóng xem CPU, memory, error rate, và RPS của các components liên quan để troubleshoot incident.

## Progress Summary

### ✅ Completed Tasks

1. **Initialized skill structure** (`/Users/chonle/.claude/skills/datadog-incident-metrics/`)
   - Created by: `skill-creator/scripts/init_skill.py`

2. **Created `scripts/query_datadog.py`** (Python script)
   - Query Datadog API cho metrics: CPU, memory, error_rate, rps
   - Support multiple components/services
   - Flexible time windows (default: 30 phút trước + 30 phút sau incident)
   - Output: JSON data với all metrics
   - Usage:
     ```bash
     python scripts/query_datadog.py \
       --components "api-gateway,auth-service,database" \
       --incident-time "2025-01-07 14:30:00" \
       --metrics "cpu,memory,error_rate,rps" \
       --output metrics_data.json
     ```
   - Environment variables required:
     - `DD_API_KEY` - Datadog API key
     - `DD_APP_KEY` - Datadog application key
     - `DD_SITE` - Datadog site (default: datadoghq.eu)

3. **Created `scripts/analyze_metrics.py`** (Python script)
   - Analyze metrics data từ query_datadog.py
   - Detect anomalies (high CPU, memory, errors, spikes)
   - Calculate statistics (min, max, avg, median, stdev)
   - Generate markdown incident report với:
     - Summary
     - Detected anomalies (CRITICAL/HIGH/MEDIUM)
     - Metrics details table
     - Recommendations
   - Usage:
     ```bash
     python scripts/analyze_metrics.py metrics_data.json --output report.md
     ```

4. **Created `references/common_metrics.md`**
   - Comprehensive list of common Datadog metrics
   - Organized by category: CPU, Memory, Error Rate, RPS, Network, Disk, Database
   - Query examples và best practices
   - Troubleshooting guide for common issues

5. **Cleaned up example files**
   - Removed: `scripts/example.py`, `references/api_reference.md`, `assets/`

### ✅ Recently Completed

6. **Wrote `SKILL.md`** - Main skill documentation ✅ (2025-11-07)
   - ✅ Added YAML frontmatter (name, description)
   - ✅ Explained purpose và when to use skill
   - ✅ Documented workflow for incident response (two-step process)
   - ✅ Included examples of how to use scripts
   - ✅ Referenced the bundled resources (scripts/, references/)
   - ✅ Added example interactions for common scenarios
   - ✅ Included setup instructions and troubleshooting guide
   - ✅ Documented advanced usage patterns
   - ✅ Added tips for Claude on how to use the skill

### ⏳ Remaining Tasks

1. **Create requirements.txt**
   - [ ] Add Python dependencies: `requests`, `python-dateutil`
   - [ ] File location: `/Users/chonle/.claude/skills/datadog-incident-metrics/requirements.txt`

2. **Package the skill**
   - [ ] Run: `python /Users/chonle/.claude/skills/skill-creator/scripts/package_skill.py /Users/chonle/.claude/skills/datadog-incident-metrics`
   - [ ] Validate skill structure
   - [ ] Create distributable zip file

3. **Test the skill**
   - [ ] Install skill in Claude Code
   - [ ] Test với real incident scenario
   - [ ] Verify scripts work with DD_API_KEY và DD_APP_KEY
   - [ ] Verify markdown report generation
   - [ ] Iterate based on feedback

## Key Design Decisions

1. **Component Detection: Manual Input**
   - User specifies components manually (e.g., "api-gateway,auth-service")
   - Simpler than auto-detect, more flexible

2. **Output Format: Markdown Report**
   - Text analysis với tables
   - Anomalies với severity levels
   - Recommendations based on detected issues
   - Easy to paste vào incident docs

3. **Time Window: 1 giờ (30 min before + 30 min during)**
   - Default: 30 phút trước incident + 30 phút trong incident
   - Có thể customize với `--before` và `--after` flags

4. **Metrics Covered:**
   - CPU (system.cpu.user, container.cpu.usage, etc.)
   - Memory (system.mem.used, container.memory.usage, etc.)
   - Error Rate (trace.*.errors, http.status_code.5xx, etc.)
   - RPS (trace.*.hits, http.requests, etc.)

## File Structure

```
datadog-incident-metrics/
├── SKILL.md                              # TODO: Write this
├── scripts/
│   ├── query_datadog.py                  # ✅ Query Datadog API
│   └── analyze_metrics.py                # ✅ Analyze & generate report
└── references/
    └── common_metrics.md                 # ✅ Metrics reference
```

## Next Steps for Continuation

1. **Write SKILL.md** với structure:
   ```markdown
   ---
   name: datadog-incident-metrics
   description: Query and analyze Datadog metrics during incidents. Use when investigating incidents to quickly retrieve CPU, memory, error rate, and RPS metrics for affected components and generate analysis reports.
   ---

   # Datadog Incident Metrics

   [Purpose and usage instructions...]
   ```

2. **SKILL.md Content Guidelines:**
   - Use imperative/infinitive form (verb-first)
   - Explain when Claude should use this skill
   - Document the two-step workflow:
     1. Query metrics with `scripts/query_datadog.py`
     2. Analyze and generate report with `scripts/analyze_metrics.py`
   - Reference `references/common_metrics.md` for metric details
   - Include example commands
   - Note environment variable requirements

3. **Testing Checklist:**
   - [ ] Scripts executable: `chmod +x scripts/*.py`
   - [ ] DD_API_KEY và DD_APP_KEY set
   - [ ] Test query with real component names
   - [ ] Verify JSON output format
   - [ ] Test analysis with sample data
   - [ ] Verify markdown report generation
   - [ ] Check anomaly detection works

## Example Workflow (for SKILL.md)

```bash
# Step 1: Query Datadog metrics
python scripts/query_datadog.py \
  --components "api-gateway,auth-service,redis" \
  --incident-time "30m ago" \
  --output /tmp/metrics.json

# Step 2: Analyze and generate report
python scripts/analyze_metrics.py /tmp/metrics.json \
  --output incident_report.md

# View report
cat incident_report.md
```

## Environment Setup (for users)

```bash
# Required environment variables
export DD_API_KEY="your_datadog_api_key"
export DD_APP_KEY="your_datadog_app_key"
export DD_SITE="datadoghq.eu"  # Optional, default: datadoghq.eu

# Optional: Add to ~/.bashrc or ~/.zshrc for persistence
```

## Contact Information

- Skill location: `/Users/chonle/.claude/skills/datadog-incident-metrics/`
- Skill creator: `/Users/chonle/.claude/skills/skill-creator/`
- Current working directory: `/Users/chonle/Documents/feee/slar-oss/api/ai`

## References

- Datadog API docs: https://docs.datadoghq.com/api/latest/metrics/
- Datadog query syntax: https://docs.datadoghq.com/dashboards/functions/
- Skill creation guide: `/Users/chonle/.claude/skills/skill-creator/SKILL.md`
