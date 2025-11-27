// Worker API client for Cloudflare Worker metrics
// This client fetches metrics directly from Worker with CDN caching (60s)
// Much faster than Go API → Cloudflare API → D1 path

class WorkerAPIClient {
  constructor() {
    // Worker URL will be set per deployment
    this.workerUrls = {}
  }

  /**
   * Set worker URL for a specific deployment
   * @param {string} deploymentId - Deployment ID
   * @param {string} workerUrl - Worker URL (e.g., https://slar-worker.xxx.workers.dev)
   */
  setWorkerUrl(deploymentId, workerUrl) {
    this.workerUrls[deploymentId] = workerUrl
  }

  /**
   * Get worker URL for a deployment
   * @param {string} deploymentId - Deployment ID
   * @returns {string|null} Worker URL or null
   */
  getWorkerUrl(deploymentId) {
    return this.workerUrls[deploymentId] || null
  }

  /**
   * Generic request to worker
   * @param {string} deploymentId - Deployment ID
   * @param {string} endpoint - API endpoint
   * @returns {Promise<object>} Response data
   */
  async request(deploymentId, endpoint) {
    const workerUrl = this.getWorkerUrl(deploymentId)
    if (!workerUrl) {
      throw new Error(`Worker URL not set for deployment ${deploymentId}`)
    }

    const url = `${workerUrl}${endpoint}`
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Worker API error: ${response.status}`)
      }

      // Get cache status from header
      const cacheStatus = response.headers.get('X-Cache-Status')
      const data = await response.json()
      
      return {
        ...data,
        _cache_status: cacheStatus // HIT or MISS
      }
    } catch (error) {
      console.error('Worker API request failed:', error)
      throw error
    }
  }

  /**
   * GET /api/metrics - All monitors with latest status (CDN cached)
   * @param {string} deploymentId - Deployment ID
   * @returns {Promise<object>} Metrics data
   */
  async getMetrics(deploymentId) {
    return this.request(deploymentId, '/api/metrics')
  }

  /**
   * GET /api/monitors - List monitors with current status (CDN cached)
   * @param {string} deploymentId - Deployment ID
   * @returns {Promise<object>} Monitors list
   */
  async getMonitors(deploymentId) {
    return this.request(deploymentId, '/api/monitors')
  }

  /**
   * GET /api/monitors/:id - Detailed stats for specific monitor (CDN cached)
   * @param {string} deploymentId - Deployment ID
   * @param {string} monitorId - Monitor ID
   * @returns {Promise<object>} Monitor stats with 7-day history
   */
  async getMonitorStats(deploymentId, monitorId) {
    return this.request(deploymentId, `/api/monitors/${monitorId}`)
  }

  /**
   * GET /health - Worker health check (not cached)
   * @param {string} deploymentId - Deployment ID
   * @returns {Promise<object>} Health status
   */
  async checkHealth(deploymentId) {
    return this.request(deploymentId, '/health')
  }
}

export const workerApi = new WorkerAPIClient()
export default workerApi
