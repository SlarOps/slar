# SLAR Runbooks — Seed Set for RAG Testing

> Purpose: a compact but realistic corpus to test SLAR's AI RAG features. Each runbook uses a consistent structure and rich keywords to improve retrieval quality.

---

## [RUNBOOK] API latency spike on `slar-api`

**Tags:** api, latency, p95, nextjs, gloo, envoy, gke, cloud-nat, gzip, network-egress, slar-api, region-to-region

**When to use**
- Alerts: `slo.latency.p95 > 800ms for 5m` OR `error_rate > 2%` on `slar-api`.
- Symptoms: UI slow, timeouts from `slar-web`, increased 5xx at Gloo/Envoy.

**Immediate actions (10–15 min)**
1. Confirm user impact: check Grafana dashboard `SLAR/API Overview` and Datadog monitor `slar-api p95`.
2. Verify pod health:
   ```bash
   kubectl -n slar get pods -l app=slar-api -o wide
   kubectl -n slar logs deploy/slar-api --tail=200
   ```
3. Check Envoy/Gloo edge:
   ```bash
   kubectl -n gloo get vs,gw,upstream | grep slar-api
   kubectl -n gloo logs deploy/gateway-proxy --tail=200 | grep -E "upstream_reset|upstream_rq_timeout|503"
   ```
4. Compare cross-zone/region egress and gzip on gateway.

**Triage checklist**
- Recent deploy? `kubectl -n slar rollout history deploy/slar-api`.
- CPU throttle / GC? `container_cpu_usage_seconds_total`, `go_gc_duration_seconds`.
- CORS/redirect (Teleport) on preflight? Look for `307/308` in proxy logs.
- Gzip CPU vs latency tradeoff.

**Deep dive**
- Profile hot endpoints via `/debug/pprof` (if enabled) or temporary pprof sidecar.
- DB slow queries in Postgres: `pg_stat_statements` top 10.

**Mitigation options**
- Rollback last image: `kubectl -n slar rollout undo deploy/slar-api`.
- Temporarily raise `per_try_timeout` in Gloo route to 10s; increase retries to 5.
- Enable/verify gzip at edge for JSON payloads; cap response size.

**Verification**
- p95 back < 400ms for 15m; 5xx < 0.5%.

**Post-incident**
- Add RED metrics panel; update SLO burn alert.

---

## [RUNBOOK] CORS preflight fails via Teleport proxy

**Tags:** cors, teleport, preflight, 307, 308, browser, slar-web, slar-api, gloo, envoy

**When to use**
- Browser console: `Response to preflight request doesn't pass access control check: Redirect is not allowed for a preflight request.`

**Immediate actions**
1. Confirm OPTIONS path is not auth-redirected by Teleport.
2. Ensure Gloo/Envoy VirtualService has CORS config at **virtualHost** level (not only route):
   ```yaml
   virtualHost:
     options:
       cors:
         allowOrigin: ["https://<web-domain>"]
         allowMethods: [GET, POST, PUT, DELETE, OPTIONS]
         allowHeaders: ["*"]
         exposeHeaders: ["origin"]
         allowCredentials: true
   ```
3. Bypass Teleport for `/incidents` OPTIONS by allowing anonymous preflight.

**Mitigations**
- Ensure upstream does not 30x OPTIONS; add explicit route matcher for `method: OPTIONS`.
- Verify `Access-Control-Allow-Origin` is exact (not `*`) when credentials used.

**Verification**
- Preflight 200; no redirect; network tab green.

---

## [RUNBOOK] WebSocket (WSS) mixed-content / bad URL

**Tags:** websocket, wss, nginx, envoy, nextjs, mixed-content, secure, root-domain, ws-proxy

**Symptom**
- Browser error like: `attempted to connect to 'ws://https//<domain>'` or mixed content blocked.

**Checklist**
1. Ensure URL formation:
   ```ts
   const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/chat';
   ```
2. Edge proxy config (Nginx/Envoy): upgrade headers for WS.
   - Nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`
3. Health-check backend:
   ```bash
   websocat wss://<root-domain>/ws/chat --origin https://<root-domain>
   ```
4. For Next.js SSR env, avoid hard-coded `NEXT_PUBLIC_WS_URL` per env; derive from `window.location`.

**Mitigation**
- Add dedicated `/ws/` route in proxy with sticky to WS service.

---

## [RUNBOOK] Kafka consumer lag explosion

**Tags:** kafka, consumer-lag, sarama, backpressure, autoscaling, keda, partition, max.poll.interval.ms

**Detection**
- Alert: `consumer_lag > 50k for 5m` on group `slar-workers`.

**Triage**
- Check broker health and ISR.
- Identify slow consumer:
  ```bash
  kafka-consumer-groups --bootstrap-server <brokers> --group slar-workers --describe
  ```
- Look for rebalancing loops; `max.poll.interval.ms` exceeded.

**Mitigation**
- Temporarily scale workers: `kubectl -n slar scale deploy/slar-worker --replicas=4`.
- Increase partitions if CPU has headroom; ensure idempotent producers.
- Apply KEDA ScaledObject on lag metric.

**Post**
- Tune batch size, compression (lz4/zstd), and parallelism.

---

## [RUNBOOK] OpenSearch read timeouts / shard pressure

**Tags:** opensearch, shard, thread_pool.search, queue_size, remote_store, coordinator, index_settings

**Detection**
- Alert: `thread_pool.search.queue > 100 for 10m` or many `search.timeout_exception`.

**Diagnostics**
```bash
curl -s http://<node>/_cat/thread_pool/search?v
curl -s http://<node>/_cat/indices?v
curl -s http://<node>/_cluster/health?pretty
```

**Mitigation**
- Reduce shards of hot indices (target 20–40GB per shard); force merge cold.
- Add/resize coordinator nodes; raise `search.max_buckets` cautiously.
- Enable segment replication or remote store if not configured.

**Verify**
- Queue < 20; p95 search < 200ms.

---

## [RUNBOOK] Supabase connection limits hit (max connections/session)

**Tags:** supabase, postgres, max_connections, pooler, pgbouncer, free-tier, auth, rls

**Symptoms**
- API errors: `too many connections`; auth failures at peak.

**Steps**
1. Inspect Postgres:
   ```sql
   SELECT pid, usename, state, query FROM pg_stat_activity LIMIT 20;
   SHOW max_connections;
   ```
2. Enable PgBouncer session/transaction pooling; reuse connections from API/workers.
3. Lower ORM pool size; add server-side timeouts and connection TTL.

**Mitigation**
- Throttle background jobs; stagger cron with KEDA.

---

## [RUNBOOK] Kubernetes CrashLoopBackOff on `slar-web`

**Tags:** kubernetes, nextjs, crashloop, env, configmap, secret, imagepull, readiness, liveness

**Triage**
```bash
kubectl -n slar describe pod -l app=slar-web
kubectl -n slar logs deploy/slar-web --previous --tail=200
```
- Check `NEXT_PUBLIC_*` vs SSR-only env; missing Supabase URL causes boot fail.

**Mitigation**
- Add startup probe with generous `failureThreshold`.
- Validate env via initContainer `printenv | sort` (no secrets in logs in prod).
- Roll back image if recent deploy.

---

## [RUNBOOK] TLS cert about to expire (edge)

**Tags:** tls, certificate, letsencrypt, cert-manager, cloudflare, sni, gloo, nginx

**Detection**
- Alert: `cert_expiry_days < 14` for `slar-web` or `slar-api` domains.

**Steps**
1. Verify cert-manager orders:
   ```bash
   kubectl -n cert-manager get certificate,order,challenge
   kubectl -n cert-manager logs deploy/cert-manager --tail=200
   ```
2. Check DNS01/HTTP01 challenges; ensure Cloudflare API token is valid.

**Mitigation**
- Force renew: `kubectl -n cert-manager annotate certificate <name> cert-manager.io/renewal-reason="manual-test" --overwrite`.
- Temporary: upload manual cert to gateway if SLO risk.

---

## [RUNBOOK] Inter-zone/region egress cost spike

**Tags:** gcp, egress, inter-zone, inter-region, neg, cloud-nat, cost, gzip

**Detection**
- Daily cost anomaly on `Network Inter-Zone/Inter-Region Data Transfer Out`.

**Steps**
1. Identify traffic path: NEG -> gateway -> service -> DB. Look for cross-zone backends.
2. Confirm StatefulSet/Service topology keys: `topology.kubernetes.io/zone`.
3. Enable gzip at edge for JSON; cache CDN-able endpoints.

**Mitigation**
- Co-locate backends; pin zones; review Cloud NAT egress.

---

## [RUNBOOK] Critical CPU usage detected on production web server 3

**Tags:** cpu, production, web-server, nodejs, golang, high-load, k8s, autoscaling, monitoring, grafana, datadog

**Detection**
- Alert: `cpu.usage.total > 90% for 10m` on `prod-web-3`.
- Symptoms: slower response times, increased request queueing, possible 5xx.

**Immediate actions (10–15 min)**
1. Validate alert in monitoring: Grafana `SLAR/Web Nodes` dashboard, Datadog `cpu.usage` for `prod-web-3`.
2. SSH or `kubectl exec` into pod/node:
   ```bash
   top -o %CPU
   ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%cpu | head -15
   ```
3. Check logs for traffic spikes or runaway tasks:
   ```bash
   kubectl -n slar logs deploy/slar-web --tail=200
   ```
4. Verify load balancer distribution — is traffic skewed to `web-3`?

**Triage checklist**
- Recent deploy? New build may cause loops.
- Any background tasks running on web pods instead of workers?
- KEDA/autoscaler triggers firing correctly?

**Mitigation options**
- Temporarily scale web deployment:
  ```bash
  kubectl -n slar scale deploy/slar-web --replicas=6
  ```
- Restart only impacted pod to clear runaway processes.
- If node-level, cordon + drain `prod-web-3` and shift traffic.

**Verification**
- CPU < 70% sustained for 15m.
- Latency and error rate back to baseline.

**Post-incident**
- Add per-pod CPU alerting panel.
- Ensure non-web workloads (jobs/consumers) are not scheduled on web nodes.
- Review autoscaling thresholds.

---

## Template (copy for new runbooks)

**Tags:** <comma separated keywords>

**When to use**
- <alerts & symptoms>

**Immediate actions (10–15 min)**
1. <checks>

**Triage checklist**
- <what to verify>

**Deep dive**
- <in-depth diagnostics>

**Mitigation options**
- <actions>

**Verification**
- <success criteria>

**Post-incident**
- <follow-ups>
