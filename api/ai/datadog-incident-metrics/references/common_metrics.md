# Common Datadog Metrics Reference

This document lists common Datadog metrics for incident troubleshooting, organized by category.

## CPU Metrics

### System-level CPU
- `system.cpu.user` - CPU time spent in user space (%)
- `system.cpu.system` - CPU time spent in kernel space (%)
- `system.cpu.idle` - CPU idle time (%)
- `system.cpu.iowait` - CPU time waiting for I/O (%)
- `system.cpu.stolen` - CPU time stolen by hypervisor (%)

### Container CPU
- `container.cpu.usage` - Container CPU usage (%)
- `container.cpu.throttled` - Container CPU throttling events
- `kubernetes.cpu.usage.total` - Kubernetes pod CPU usage

### Cloud Provider CPU
- `aws.ec2.cpuutilization` - AWS EC2 CPU utilization (%)
- `gcp.compute.instance.cpu.utilization` - GCP Compute Engine CPU
- `azure.vm.percentage_cpu` - Azure VM CPU percentage

### Application-level CPU
- `runtime.go.num_cpu` - Go runtime CPU count
- `runtime.python.cpu.time` - Python CPU time
- `jvm.cpu.load` - JVM CPU load

## Memory Metrics

### System-level Memory
- `system.mem.used` - Memory used (bytes)
- `system.mem.usable` - Usable memory (bytes)
- `system.mem.free` - Free memory (bytes)
- `system.mem.total` - Total memory (bytes)
- `system.mem.pct_usable` - Percentage of usable memory

### Container Memory
- `container.memory.usage` - Container memory usage (bytes)
- `container.memory.rss` - Container RSS memory (bytes)
- `container.memory.cache` - Container cache memory (bytes)
- `kubernetes.memory.usage` - Kubernetes pod memory usage

### Cloud Provider Memory
- `aws.ec2.memory_utilization` - AWS EC2 memory utilization (%)
- `gcp.compute.instance.memory.utilization` - GCP memory
- `azure.vm.available_memory_bytes` - Azure available memory

### Application-level Memory
- `runtime.go.mem.heap_alloc` - Go heap allocation
- `runtime.python.mem.rss` - Python RSS memory
- `jvm.heap_memory` - JVM heap memory usage
- `jvm.heap_memory_max` - JVM max heap memory

## Error Rate Metrics

### APM Traces
- `trace.{service}.errors` - Service error count (APM)
- `trace.{service}.error_rate` - Service error rate (APM)
- `trace.{resource}.errors` - Resource error count (APM)

### HTTP Status Codes
- `http.status_code.4xx` - Client errors (4xx)
- `http.status_code.5xx` - Server errors (5xx)
- `http.errors` - HTTP error count
- `nginx.error.rate` - Nginx error rate

### Application Errors
- `application.errors` - Application error count
- `error.count` - Generic error count
- `exception.count` - Exception count
- `log.error.count` - Error log count

### Database Errors
- `postgresql.connection.errors` - PostgreSQL connection errors
- `mysql.connection.errors` - MySQL connection errors
- `redis.errors` - Redis errors

## Request Rate / RPS Metrics

### APM Traces
- `trace.{service}.hits` - Service request count (APM)
- `trace.{service}.request.hits` - Service requests per second
- `trace.{resource}.hits` - Resource hit count

### HTTP Requests
- `http.requests` - HTTP request count
- `http.requests.rate` - HTTP requests per second
- `nginx.requests.total` - Nginx total requests
- `nginx.requests.rate` - Nginx request rate

### Application Requests
- `application.requests_per_second` - App RPS
- `requests.count` - Request count
- `web.requests` - Web request count
- `api.requests.count` - API request count

### Load Balancer
- `aws.elb.request_count` - AWS ELB requests
- `gcp.loadbalancing.request_count` - GCP LB requests
- `azure.loadbalancer.packet_count` - Azure LB packets

## Network Metrics

### Network I/O
- `system.net.bytes_rcvd` - Bytes received
- `system.net.bytes_sent` - Bytes sent
- `system.net.packets_in` - Packets received
- `system.net.packets_out` - Packets sent

### Network Errors
- `system.net.errors.in` - Inbound network errors
- `system.net.errors.out` - Outbound network errors
- `system.net.drops.in` - Inbound packet drops
- `system.net.drops.out` - Outbound packet drops

### Connection Metrics
- `system.net.tcp.connections` - TCP connections
- `system.net.tcp.retrans_segs` - TCP retransmissions
- `nginx.connections.active` - Active Nginx connections

## Disk Metrics

### Disk I/O
- `system.disk.read_bytes` - Disk read bytes
- `system.disk.write_bytes` - Disk write bytes
- `system.disk.read_time` - Disk read time
- `system.disk.write_time` - Disk write time

### Disk Usage
- `system.disk.used` - Disk space used (bytes)
- `system.disk.free` - Disk space free (bytes)
- `system.disk.total` - Total disk space (bytes)
- `system.disk.in_use` - Disk usage percentage

### Disk Performance
- `system.disk.iops.read` - Read IOPS
- `system.disk.iops.write` - Write IOPS
- `system.disk.latency.read` - Read latency
- `system.disk.latency.write` - Write latency

## Database Metrics

### PostgreSQL
- `postgresql.connections` - Active connections
- `postgresql.queries.rate` - Query rate
- `postgresql.locks` - Lock count
- `postgresql.deadlocks` - Deadlock count
- `postgresql.temp_files` - Temporary files
- `postgresql.cache.hit_rate` - Cache hit rate

### MySQL
- `mysql.connections` - Active connections
- `mysql.queries.rate` - Query rate
- `mysql.slow_queries` - Slow query count
- `mysql.threads.running` - Running threads
- `mysql.innodb.buffer_pool.hit_rate` - Buffer pool hit rate

### Redis
- `redis.connected_clients` - Connected clients
- `redis.commands.processed.rate` - Commands per second
- `redis.mem.used` - Memory used
- `redis.keys.evicted` - Evicted keys
- `redis.net.connections.rejected` - Rejected connections

### MongoDB
- `mongodb.connections.current` - Current connections
- `mongodb.operations.rate` - Operations per second
- `mongodb.memory.resident` - Resident memory
- `mongodb.locks.time_acquiring` - Lock acquisition time

## Application Performance Metrics

### Response Time
- `trace.{service}.duration.avg` - Average response time
- `trace.{service}.duration.p50` - Median response time
- `trace.{service}.duration.p95` - 95th percentile
- `trace.{service}.duration.p99` - 99th percentile

### Throughput
- `trace.{service}.hits.rate` - Request rate
- `trace.{service}.request.hits` - Total requests

### Apdex Score
- `trace.{service}.apdex` - Application performance index

## Message Queue Metrics

### RabbitMQ
- `rabbitmq.queue.messages` - Messages in queue
- `rabbitmq.queue.messages.rate` - Message rate
- `rabbitmq.queue.consumers` - Consumer count
- `rabbitmq.connections` - Active connections

### Kafka
- `kafka.messages.rate` - Message rate
- `kafka.consumer.lag` - Consumer lag
- `kafka.broker.bytes.in` - Bytes in
- `kafka.broker.bytes.out` - Bytes out

## Custom Metrics Patterns

### Common Patterns
- `custom.{service}.{metric_name}` - Custom service metrics
- `app.{component}.{metric_name}` - Application component metrics
- `business.{kpi_name}` - Business KPI metrics

### Metric Naming Best Practices
1. Use dots (.) as separators
2. Start with namespace (e.g., `system`, `app`, `custom`)
3. Include component/service name
4. End with metric name and unit if applicable
5. Use lowercase and underscores

## Metric Query Examples

### Query by Service Tag
```
avg:system.cpu.user{service:api-gateway}
avg:system.mem.usable{service:auth-service}
```

### Query by Environment
```
avg:trace.web.errors{env:production}
sum:http.requests{env:staging}
```

### Query by Multiple Tags
```
avg:system.cpu.user{service:api,env:prod,region:us-east-1}
```

### Aggregation Functions
- `avg:` - Average across hosts
- `sum:` - Sum across hosts
- `min:` - Minimum value
- `max:` - Maximum value
- `count:` - Count of data points

### Time Aggregation
- `avg:metric{*}.rollup(avg, 60)` - 1-minute average
- `max:metric{*}.rollup(max, 300)` - 5-minute maximum

## Troubleshooting Common Issues

### High CPU
**Check these metrics:**
- `system.cpu.user` - Application CPU
- `system.cpu.system` - Kernel CPU
- `system.cpu.iowait` - I/O wait
- `system.load.1` - Load average

**Common causes:**
- Infinite loops
- CPU-intensive operations
- Too many threads/processes
- Inefficient algorithms

### High Memory
**Check these metrics:**
- `system.mem.used` - Total memory used
- `system.mem.pct_usable` - Percentage available
- `jvm.heap_memory` (for Java)
- `runtime.go.mem.heap_alloc` (for Go)

**Common causes:**
- Memory leaks
- Large data structures in memory
- Insufficient garbage collection
- Cache not properly bounded

### High Error Rate
**Check these metrics:**
- `trace.{service}.errors` - Service errors
- `http.status_code.5xx` - Server errors
- `log.error.count` - Error logs
- Database error metrics

**Common causes:**
- Code bugs
- Dependency failures
- Database connection issues
- API rate limiting

### Low RPS / Traffic Drop
**Check these metrics:**
- `trace.{service}.hits` - Request count
- `http.requests.rate` - HTTP request rate
- Load balancer metrics
- Network metrics

**Common causes:**
- Upstream service failure
- Network issues
- Rate limiting triggered
- Client-side errors preventing requests
