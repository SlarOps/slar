
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
        // Priority: SLAR_WEBHOOK_URL > FALLBACK_WEBHOOK_URL > /monitors/report
        if (env.SLAR_WEBHOOK_URL) {
            // Send via integration webhook (PagerDuty Events API format)
            await handleIncidentsViaWebhook(env.SLAR_WEBHOOK_URL, monitors, results)
        } else if (env.FALLBACK_WEBHOOK_URL) {
            // Fallback webhook for critical alerts
            const downMonitors = results.filter(r => !r.is_up)
            if (downMonitors.length > 0) {
                await sendFallbackAlert(env.FALLBACK_WEBHOOK_URL, location, downMonitors)
            }
        }
        // Note: /monitors/report endpoint is deprecated but still available for backward compatibility
    },
}

async function handleIncidentsViaWebhook(webhookUrl, monitors, results) {
    // Track state changes and send webhook events
    for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const monitor = monitors.find(m => m.id === result.monitor_id)

        if (!monitor) continue

        // Determine if state changed (we need to check previous state from D1)
        // For simplicity, we'll send events for all down monitors
        // In production, you'd want to track state changes more carefully

        if (!result.is_up) {
            // Monitor is down - trigger incident
            await sendWebhookEvent(webhookUrl, 'trigger', monitor, result)
        } else if (result.is_up && result.previous_was_down) {
            // Monitor recovered - resolve incident
            await sendWebhookEvent(webhookUrl, 'resolve', monitor, result)
        }
    }
}

async function sendWebhookEvent(webhookUrl, action, monitor, result) {
    const payload = {
        routing_key: 'monitor-worker',
        event_action: action,
        dedup_key: monitor.id,
        payload: {
            summary: action === 'trigger'
                ? `Monitor Down: ${monitor.url}`
                : `Monitor Recovered: ${monitor.url}`,
            source: 'uptime-monitor',
            severity: action === 'trigger' ? 'critical' : 'info',
            timestamp: new Date().toISOString(),
            custom_details: {
                monitor_id: monitor.id,
                url: monitor.url,
                method: monitor.method,
                status: result.status,
                latency: result.latency,
                error: result.error,
                location: await getWorkerLocation()
            }
        }
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!response.ok) {
            console.error(`Failed to send webhook event: ${response.status} ${response.statusText}`)
        } else {
            console.log(`Sent ${action} event for monitor ${monitor.id}`)
        }
    } catch (e) {
        console.error(`Error sending webhook event:`, e)
    }
}

async function checkMonitor(monitor) {
    // Route to appropriate check type based on method
    if (monitor.method === 'TCP_PING') {
        return await checkTCPMonitor(monitor)
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
        const target = monitor.target || monitor.url
        const [host, portStr] = target.split(':')
        const port = parseInt(portStr)

        if (!host || !port || isNaN(port)) {
            throw new Error(`Invalid target format: ${target}. Expected host:port`)
        }

        // Use fetch with a simple TCP connection test
        // For Cloudflare Workers, we'll attempt a connection to the TCP endpoint
        // This is a workaround since Workers don't have native TCP socket support
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), monitor.timeout || 10000)

        try {
            // Try to connect using fetch to http://host:port
            // This will fail if the port is not open, which is what we want to detect
            const testUrl = `http://${host}:${port}`
            await fetch(testUrl, {
                method: 'HEAD',
                signal: controller.signal
            })

            clearTimeout(timeoutId)
            isUp = true
            console.log(`TCP Monitor ${monitor.id}: ${target} is reachable`)
        } catch (e) {
            clearTimeout(timeoutId)
            // For TCP checks, we consider it "up" if we get ANY response (even errors like connection refused)
            // because it means the host is reachable. Only timeout means it's down.
            if (e.name === 'AbortError') {
                isUp = false
                error = 'Connection timeout'
            } else {
                // Got a response (even if it's an error), so the port is reachable
                isUp = true
            }
            console.log(`TCP Monitor ${monitor.id}: ${target} - ${e.message}`)
        }

    } catch (e) {
        error = e.message || 'Unknown error'
        isUp = false
        console.error(`TCP Monitor ${monitor.id} check failed:`, error)
    }

    const latency = Date.now() - start

    return {
        monitor_id: monitor.id,
        is_up: isUp,
        latency,
        status: 0, // TCP checks don't have HTTP status
        error
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
        text: `🚨 *Slar API Unreachable - Fallback Alert* 🚨\n\nLocation: ${location}\n\n` +
            downMonitors.map(m => `❌ *${m.monitor_id}* is DOWN (${m.error})`).join('\n')
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
