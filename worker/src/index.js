
export default {
    async scheduled(event, env, ctx) {
        // 1. Read config from D1
        let monitors = []
        try {
            const { results } = await env.SLAR_DB.prepare('SELECT * FROM monitors WHERE is_active = 1').all()
            monitors = results
        } catch (e) {
            console.error('Failed to read monitors from D1:', e)
            return
        }

        if (!monitors || monitors.length === 0) {
            console.log('No active monitors configured')
            return
        }

        const location = (await getWorkerLocation()) || 'UNKNOWN'
        console.log(`Running checks from ${location} for ${monitors.length} monitors`)

        // 2. Run checks
        const results = await Promise.all(monitors.map(m => checkMonitor(m)))

        // 3. Save logs to D1
        try {
            const stmt = env.SLAR_DB.prepare(`
            INSERT INTO monitor_logs (monitor_id, location, status, latency, error, is_up, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `)

            const batch = results.map(r => stmt.bind(
                r.monitor_id,
                location,
                r.status,
                r.latency,
                r.error,
                r.is_up ? 1 : 0,
                Math.floor(Date.now() / 1000)
            ))

            await env.SLAR_DB.batch(batch)
            console.log(`Saved ${results.length} check results to D1`)
        } catch (e) {
            console.error('Failed to save logs to D1:', e)
        }

        // 4. Handle incident reporting
        // Note: API metrics are cached at CDN edge level (s-maxage=60)
        // No need to cache in D1 - CDN handles it automatically!
        // Priority: SLAR_WEBHOOK_URL > FALLBACK_WEBHOOK_URL > /monitors/report
        if (env.SLAR_WEBHOOK_URL) {
            // Send via integration webhook (PagerDuty Events API format)
            await handleIncidentsViaWebhook(env, env.SLAR_WEBHOOK_URL, monitors, results)
        } else if (env.FALLBACK_WEBHOOK_URL) {
            // Fallback webhook for critical alerts
            const downMonitors = results.filter(r => !r.is_up)
            if (downMonitors.length > 0) {
                await sendFallbackAlert(env.FALLBACK_WEBHOOK_URL, location, downMonitors)
            }
        }
        // Note: /monitors/report endpoint is deprecated but still available for backward compatibility
    },

    // HTTP API for metrics with Cloudflare CDN Cache
    async fetch(request, env, ctx) {
        const url = new URL(request.url)
        
        // CORS headers for browser requests
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders })
        }

        // Health check (no cache)
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            })
        }

        // Helper to add CORS headers to any response
        const addCorsHeaders = (response, cacheStatus) => {
            const newHeaders = new Headers(response.headers)
            // Always set CORS headers (overwrite if exists)
            newHeaders.set('Access-Control-Allow-Origin', '*')
            newHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
            newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            newHeaders.set('X-Cache-Status', cacheStatus)
            return new Response(response.body, {
                status: response.status,
                headers: newHeaders
            })
        }

        // Check CDN Cache first (only for GET requests)
        const cache = caches.default
        const cacheKey = new Request(url.toString(), { method: 'GET' })
        
        let response = await cache.match(cacheKey)
        if (response) {
            // CACHE HIT
            return addCorsHeaders(response, 'HIT')
        }

        // CACHE MISS - Query D1 and cache response
        try {
            if (url.pathname === '/api/metrics') {
                response = await handleGetMetrics(env, request, corsHeaders)
            } else if (url.pathname === '/api/monitors') {
                response = await handleGetMonitors(env, request, corsHeaders)
            } else if (url.pathname.startsWith('/api/monitors/')) {
                const monitorId = url.pathname.split('/')[3]
                response = await handleGetMonitorStats(env, monitorId, corsHeaders)
            } else {
                return new Response('Not Found', { status: 404, headers: corsHeaders })
            }

            // Store in CDN Cache (only successful responses)
            if (response.ok) {
                const cacheResponse = response.clone()
                ctx.waitUntil(cache.put(cacheKey, cacheResponse))
            }

            return addCorsHeaders(response, 'MISS')
        } catch (error) {
            console.error('API error:', error)
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            })
        }
    }
}

async function handleIncidentsViaWebhook(env, webhookUrl, monitors, results) {
    // Only send webhooks on state changes to prevent alert fatigue
    // Query previous state from D1 for each monitor

    for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const monitor = monitors.find(m => m.id === result.monitor_id)

        if (!monitor) continue

        // Get previous check result from D1
        const previousState = await getPreviousMonitorState(env, result.monitor_id)

        // Detect state changes
        const currentlyUp = result.is_up
        const previouslyUp = previousState ? previousState.is_up : true // Assume UP if no history

        // Only send webhook on state change
        if (!currentlyUp && previouslyUp) {
            // State changed: UP → DOWN (trigger incident)
            console.log(`Monitor ${monitor.id} state changed: UP → DOWN`)
            await sendWebhookEvent(webhookUrl, 'trigger', monitor, result)
        } else if (currentlyUp && !previouslyUp) {
            // State changed: DOWN → UP (resolve incident)
            console.log(`Monitor ${monitor.id} state changed: DOWN → UP`)
            await sendWebhookEvent(webhookUrl, 'resolve', monitor, result)
        } else if (!currentlyUp && !previouslyUp) {
            // Still down - no webhook (prevent spam)
            console.log(`Monitor ${monitor.id} still DOWN - no webhook sent`)
        } else {
            // Still up - no webhook needed
            console.log(`Monitor ${monitor.id} still UP`)
        }
    }
}

async function getPreviousMonitorState(env, monitorId) {
    try {
        // Query the most recent check result for this monitor
        const result = await env.SLAR_DB.prepare(`
            SELECT is_up, created_at 
            FROM monitor_logs 
            WHERE monitor_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1 OFFSET 1
        `).bind(monitorId).first()

        if (result) {
            return {
                is_up: result.is_up === 1,
                created_at: result.created_at
            }
        }

        return null
    } catch (e) {
        console.error(`Failed to get previous state for monitor ${monitorId}:`, e)
        return null
    }
}

async function sendWebhookEvent(webhookUrl, action, monitor, result) {
    // Use Generic Webhook format matching backend expectations
    const payload = {
        alert_name: `Monitor ${action === 'trigger' ? 'Down' : 'Recovered'}: ${monitor.url}`,
        severity: action === 'trigger' ? 'critical' : 'info',
        status: action === 'trigger' ? 'firing' : 'resolved',
        summary: action === 'trigger'
            ? `Monitor is unreachable: ${monitor.url}`
            : `Monitor has recovered: ${monitor.url}`,
        description: result.error || `HTTP ${result.status} - ${result.latency}ms`,
        labels: {
            source: 'uptime-monitor',
            monitor_id: monitor.id,
            url: monitor.url,
            method: monitor.method,
            location: await getWorkerLocation(),
            monitor_type: monitor.type || 'http'
        },
        annotations: {
            status_code: result.status?.toString() || 'N/A',
            latency_ms: result.latency?.toString() || 'N/A',
            error_message: result.error || '',
            check_time: new Date().toISOString()
        },
        fingerprint: monitor.id, // Use monitor ID for deduplication
        starts_at: new Date().toISOString()
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error(`Failed to send webhook event: ${response.status} ${response.statusText}`, errorText)
        } else {
            console.log(`Sent ${action} event for monitor ${monitor.id} (${monitor.url})`)
        }
    } catch (e) {
        console.error(`Error sending webhook event:`, e)
    }
}

async function checkMonitor(monitor) {
    // Route to appropriate check type basync function checkMonitor(monitor) {
    if (monitor.method === 'TCP_PING') {
        return await checkTCPMonitor(monitor)
    } else if (monitor.method === 'DNS') {
        return await checkDNSMonitor(monitor)
    } else if (monitor.method === 'CERT_CHECK') {
        return await checkCertMonitor(monitor)
    } else {
        return await checkHTTPMonitor(monitor)
    }
}

async function checkHTTPMonitor(monitor) {
    const start = Date.now()
    let isUp = false
    let status = 0
    let error = ''

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), monitor.timeout || 10000)

        // Parse headers safely
        let headers = {}
        if (monitor.headers) {
            try {
                // Headers might be a string or already an object
                headers = typeof monitor.headers === 'string'
                    ? JSON.parse(monitor.headers)
                    : monitor.headers
            } catch (e) {
                console.error(`Failed to parse headers for monitor ${monitor.id}:`, e)
                headers = {}
            }
        }

        const method = monitor.method || 'GET'
        const fetchOptions = {
            method: method,
            headers: headers,
            redirect: monitor.follow_redirect ? 'follow' : 'manual',
            signal: controller.signal
        }

        // Only include body for methods that support it
        if (method !== 'GET' && method !== 'HEAD' && monitor.body) {
            fetchOptions.body = monitor.body
        }

        const resp = await fetch(monitor.url, fetchOptions)

        clearTimeout(timeoutId)
        status = resp.status

        // Check status code
        if (monitor.expect_status) {
            isUp = status === monitor.expect_status
        } else {
            isUp = status >= 200 && status < 300
        }

        if (!isUp) {
            error = `Status ${status}`
        }

        // Response keyword validation (only if status check passed)
        if (isUp && (monitor.response_keyword || monitor.response_forbidden_keyword)) {
            try {
                const responseText = await resp.text()

                // Check for required keyword
                if (monitor.response_keyword && !responseText.includes(monitor.response_keyword)) {
                    isUp = false
                    error = `Missing keyword: ${monitor.response_keyword}`
                }

                // Check for forbidden keyword
                if (isUp && monitor.response_forbidden_keyword && responseText.includes(monitor.response_forbidden_keyword)) {
                    isUp = false
                    error = `Found forbidden keyword: ${monitor.response_forbidden_keyword}`
                }
            } catch (e) {
                console.error(`Failed to validate response for monitor ${monitor.id}:`, e)
                // Don't fail the check just because we couldn't read the response
            }
        }

        // Debug logging
        console.log(`Monitor ${monitor.id}: URL=${monitor.url}, Method=${method}, Status=${status}, IsUp=${isUp}, ExpectStatus=${monitor.expect_status}`)

    } catch (e) {
        error = e.message || 'Unknown error'
        isUp = false
        console.error(`Monitor ${monitor.id} check failed:`, error)
    }

    const latency = Date.now() - start

    return {
        monitor_id: monitor.id,
        is_up: isUp,
        latency,
        status,
        error
    }
}

async function checkTCPMonitor(monitor) {
    const start = Date.now()
    let isUp = false
    let error = ''

    try {
        // Parse host:port from target
        // Target should be in format "hostname:port" (e.g., "example.com:443" or "192.168.1.1:22")
        const target = monitor.target || monitor.url

        // Simple parsing: split by last colon to handle IPv6 addresses
        const lastColonIndex = target.lastIndexOf(':')
        if (lastColonIndex === -1) {
            throw new Error(`Invalid target format: ${target}. Expected hostname:port`)
        }

        const hostname = target.substring(0, lastColonIndex)
        const port = parseInt(target.substring(lastColonIndex + 1))

        if (!hostname || !port || isNaN(port)) {
            throw new Error(`Invalid target format: ${target}. Expected hostname:port`)
        }

        // Cloudflare Workers Sockets API doesn't allow connections to common HTTP ports
        // Fallback to HTTP fetch for ports 80, 443, 8080, 8443
        const httpPorts = [80, 443, 8080, 8443]
        if (httpPorts.includes(port)) {
            console.log(`TCP Monitor ${monitor.id}: Port ${port} is HTTP port, using fetch fallback`)

            const protocol = (port === 443 || port === 8443) ? 'https' : 'http'
            const url = `${protocol}://${hostname}:${port}`

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), monitor.timeout || 10000)

            try {
                const response = await fetch(url, {
                    method: 'HEAD',
                    signal: controller.signal
                })
                clearTimeout(timeoutId)
                isUp = true
                console.log(`TCP Monitor ${monitor.id}: ${target} is reachable (HTTP ${response.status})`)
            } catch (e) {
                clearTimeout(timeoutId)
                // Even connection errors mean the host is reachable
                if (e.name !== 'AbortError') {
                    isUp = true
                    console.log(`TCP Monitor ${monitor.id}: ${target} is reachable (got response)`)
                } else {
                    throw new Error('Connection timeout')
                }
            }
        } else {
            // Use Cloudflare Sockets API for non-HTTP ports
            // Import dynamically to support both local and Cloudflare environments
            const { connect } = await import(/* webpackIgnore: true */ 'cloudflare:sockets')

            const socket = connect({ hostname, port })

            // Create timeout promise
            const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection timed out')), monitor.timeout || 10000)
            })

            // Race between connection and timeout
            await Promise.race([socket.opened, timeout])

            // Connection successful, close the socket
            await socket.close()

            isUp = true
            console.log(`TCP Monitor ${monitor.id}: ${target} is reachable`)
        }

    } catch (e) {
        error = e.message || 'Connection failed'
        isUp = false
        console.log(`TCP Monitor ${monitor.id}: ${monitor.target || monitor.url} - ${error}`)
    }

    const latency = Date.now() - start

    return {
        monitor_id: monitor.id,
        is_up: isUp,
        latency,
        status: 0, // TCP doesn't have HTTP status
        error
    }
}

async function checkDNSMonitor(monitor) {
    const start = Date.now()
    let isUp = false
    let error = ''
    let resolvedValues = []

    try {
        const target = monitor.target || monitor.url
        const recordType = monitor.dns_record_type || 'A'

        // Use Cloudflare DNS over HTTPS
        const dnsUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(target)}&type=${recordType}`

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), monitor.timeout || 10000)

        const response = await fetch(dnsUrl, {
            headers: {
                'Accept': 'application/dns-json'
            },
            signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
            throw new Error(`DNS query failed: ${response.status}`)
        }

        const dnsData = await response.json()

        // Check if we got answers
        if (!dnsData.Answer || dnsData.Answer.length === 0) {
            throw new Error(`No DNS records found for ${target}`)
        }

        // Extract resolved values based on record type
        resolvedValues = dnsData.Answer.map(answer => {
            // For A/AAAA records, return the IP
            if (recordType === 'A' || recordType === 'AAAA') {
                return answer.data
            }
            // For CNAME, MX, TXT, return the data
            return answer.data
        })

        // Check against expected values if provided
        if (monitor.expected_values && monitor.expected_values.length > 0) {
            const expectedSet = new Set(monitor.expected_values)
            const resolvedSet = new Set(resolvedValues)

            // Check if at least one expected value matches
            const hasMatch = monitor.expected_values.some(expected => resolvedSet.has(expected))

            if (!hasMatch) {
                isUp = false
                error = `DNS mismatch. Expected: ${monitor.expected_values.join(', ')}, Got: ${resolvedValues.join(', ')}`
            } else {
                isUp = true
            }
        } else {
            // No expected values, just check if we got any resolution
            isUp = resolvedValues.length > 0
        }

        console.log(`DNS Monitor ${monitor.id}: ${target} resolved to ${resolvedValues.join(', ')}`)

    } catch (e) {
        error = e.message || 'DNS resolution failed'
        isUp = false
        console.log(`DNS Monitor ${monitor.id}: ${monitor.target || monitor.url} - ${error}`)
    }

    const latency = Date.now() - start

    return {
        monitor_id: monitor.id,
        is_up: isUp,
        latency,
        status: 0,
        error,
        resolved_values: resolvedValues.join(', ')
    }
}

async function checkCertMonitor(monitor) {
    const start = Date.now()
    let isUp = false
    let error = ''
    let certInfo = {}

    try {
        const target = monitor.target || monitor.url

        // Ensure URL starts with https://
        const url = target.startsWith('https://') ? target : `https://${target}`

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), monitor.timeout || 10000)

        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal
        })

        clearTimeout(timeoutId)

        // In Cloudflare Workers, certificate info is available via response.cf
        // However, detailed cert info like expiry date is not directly available
        // We need to use a different approach

        // For now, we'll use a simple check: if HTTPS connection succeeds, cert is valid
        // For expiry checking, we'd need to use external API or custom implementation

        if (response.ok || response.status < 500) {
            // Connection successful, certificate is valid
            isUp = true

            // Try to get TLS info from Cloudflare
            if (response.cf) {
                certInfo.tlsVersion = response.cf.tlsVersion
                certInfo.tlsCipher = response.cf.tlsCipher
            }

            console.log(`Cert Monitor ${monitor.id}: ${url} - Certificate valid`)
        } else {
            isUp = false
            error = `HTTP ${response.status}`
        }

    } catch (e) {
        error = e.message || 'Certificate check failed'
        isUp = false

        // Check if it's a TLS/SSL error
        if (error.includes('SSL') || error.includes('TLS') || error.includes('certificate')) {
            error = 'Certificate error: ' + error
        }

        console.log(`Cert Monitor ${monitor.id}: ${monitor.target || monitor.url} - ${error}`)
    }

    const latency = Date.now() - start

    return {
        monitor_id: monitor.id,
        is_up: isUp,
        latency,
        status: 0,
        error,
        cert_info: JSON.stringify(certInfo)
    }
}

async function getWorkerLocation() {
    try {
        const res = await fetch('https://cloudflare.com/cdn-cgi/trace')
        const text = await res.text()
        const lines = text.split('\n')
        const locLine = lines.find(l => l.startsWith('loc='))
        return locLine ? locLine.split('=')[1] : null
    } catch {
        return null
    }
}

async function sendFallbackAlert(webhookUrl, location, downMonitors) {
    const message = {
        text: `[ALERT] *Slar API Unreachable - Fallback Alert*\n\nLocation: ${location}\n\n` +
            downMonitors.map(m => `[DOWN] *${m.monitor_id}* is DOWN (${m.error})`).join('\n')
    }

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        })
    } catch (e) {
        console.error('Failed to send fallback alert:', e)
    }
}

// ============================================================================
// API FUNCTIONS - With Cloudflare CDN Edge Cache
// ============================================================================

/**
 * GET /api/metrics - All monitors with latest check results
 * Cached at CDN edge for 60 seconds (= check interval)
 * 
 * Flow:
 * 1. Browser → CDN Edge (check cache)
 * 2. If HIT: Return cached response (~5ms)
 * 3. If MISS: Worker → D1 → Response → Cache → Browser
 */
async function handleGetMetrics(env, request, corsHeaders) {
    try {
        const timestamp = Math.floor(Date.now() / 1000)
        const location = (await getWorkerLocation()) || 'UNKNOWN'

        // OPTIMIZED: Single query with JOIN instead of N correlated subqueries
        // Uses index: idx_monitor_logs_monitor_created (monitor_id, created_at DESC)
        const { results: monitors } = await env.SLAR_DB.prepare(`
            SELECT 
                m.id, m.url, m.target, m.method,
                l.is_up, l.latency, l.status, l.error, l.created_at as last_check
            FROM monitors m
            LEFT JOIN monitor_logs l ON l.id = (
                SELECT id FROM monitor_logs 
                WHERE monitor_id = m.id 
                ORDER BY created_at DESC LIMIT 1
            )
            WHERE m.is_active = 1
        `).all()

        const upCount = monitors.filter(m => m.is_up === 1).length
        const downCount = monitors.filter(m => m.is_up === 0).length
        const latencies = monitors.map(m => m.latency).filter(l => l > 0)
        const avgLatency = latencies.length > 0 
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
            : 0

        const data = {
            timestamp,
            location,
            monitors: monitors.map(m => ({
                id: m.id,
                name: m.url || m.target || m.id,
                url: m.url || m.target,
                method: m.method,
                is_up: m.is_up === 1,
                latency: m.latency || 0,
                status: m.status || 0,
                error: m.error || '',
                last_check: m.last_check
            })),
            summary: {
                total: monitors.length,
                up: upCount,
                down: downCount,
                avg_latency: Math.round(avgLatency)
            }
        }

        return new Response(JSON.stringify(data), {
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
                ...corsHeaders
            }
        })
    } catch (error) {
        console.error('Error fetching metrics:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
    }
}

/**
 * GET /api/monitors - List monitors with current status
 * Cached at CDN edge for 60 seconds
 */
async function handleGetMonitors(env, request, corsHeaders) {
    try {
        // OPTIMIZED: Single JOIN instead of correlated subqueries
        const { results: monitors } = await env.SLAR_DB.prepare(`
            SELECT 
                m.id, m.url, m.target, m.method,
                l.is_up, l.latency
            FROM monitors m
            LEFT JOIN monitor_logs l ON l.id = (
                SELECT id FROM monitor_logs 
                WHERE monitor_id = m.id 
                ORDER BY created_at DESC LIMIT 1
            )
            WHERE m.is_active = 1
        `).all()

        const upCount = monitors.filter(m => m.is_up === 1).length

        return new Response(JSON.stringify({ 
            monitors: monitors.map(m => ({
                id: m.id,
                name: m.url || m.target || m.id,
                url: m.url || m.target,
                method: m.method,
                is_up: m.is_up === 1,
                latency: m.latency || 0
            })),
            summary: {
                total: monitors.length,
                up: upCount,
                down: monitors.length - upCount
            }
        }), {
            headers: { 
                'Content-Type': 'application/json',
                // CDN Cache for 60 seconds
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
                ...corsHeaders
            }
        })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
    }
}

/**
 * GET /api/monitors/:id - Detailed stats for specific monitor
 * Cached at CDN edge for 60 seconds
 * OPTIMIZED: Batch queries + SQL aggregation + reduced data fetch
 */
async function handleGetMonitorStats(env, monitorId, corsHeaders) {
    try {
        // OPTIMIZED: Batch all queries together for single round trip
        const [monitorResult, statsResult, logsResult] = await env.SLAR_DB.batch([
            // Query 1: Monitor info
            env.SLAR_DB.prepare(`SELECT id, url, target, method FROM monitors WHERE id = ?`).bind(monitorId),
            // Query 2: Stats aggregation in SQL (much faster than JS)
            env.SLAR_DB.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) as up_count,
                    AVG(CASE WHEN latency > 0 THEN latency END) as avg_latency
                FROM monitor_logs
                WHERE monitor_id = ? AND created_at > unixepoch('now', '-7 days')
            `).bind(monitorId),
            // Query 3: Recent logs for chart (limit 50, enough for display)
            env.SLAR_DB.prepare(`
                SELECT is_up, latency, status, error, created_at
                FROM monitor_logs
                WHERE monitor_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            `).bind(monitorId)
        ])

        const monitor = monitorResult.results?.[0]
        if (!monitor) {
            return new Response(JSON.stringify({ error: 'Monitor not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            })
        }

        const stats = statsResult.results?.[0] || { total: 0, up_count: 0, avg_latency: 0 }
        const logs = logsResult.results || []
        const latestLog = logs[0]

        const total = stats.total || 0
        const upCount = stats.up_count || 0
        const uptimePercent = total > 0 ? (upCount / total) * 100 : 100

        return new Response(JSON.stringify({
            monitor: {
                id: monitor.id,
                name: monitor.url || monitor.target || monitorId,
                url: monitor.url || monitor.target,
                method: monitor.method,
                is_up: latestLog?.is_up === 1,
                latency: latestLog?.latency || 0,
                status: latestLog?.status || 0,
                error: latestLog?.error || '',
                last_check: latestLog?.created_at
            },
            stats: {
                period: '7d',
                uptime_percent: Math.round(uptimePercent * 100) / 100,
                total_checks: total,
                successful_checks: upCount,
                failed_checks: total - upCount,
                avg_latency_ms: Math.round(stats.avg_latency || 0)
            },
            recent_logs: logs.map(l => ({
                is_up: l.is_up === 1,
                latency: l.latency,
                status: l.status,
                error: l.error,
                timestamp: l.created_at
            }))
        }), {
            headers: { 
                'Content-Type': 'application/json',
                // CDN Cache for 60 seconds
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
                ...corsHeaders
            }
        })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
    }
}
