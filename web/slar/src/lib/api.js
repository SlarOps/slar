// API client for SLAR backend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const AI_BASE_URL =  process.env.NEXT_PUBLIC_AI_URL || '/ai'

class APIClient {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.aiBaseURL = AI_BASE_URL;
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  async request(endpoint, options = {}, baseURL = null) {
    const url = `${baseURL || this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // Get environment configuration (unified config endpoint)
  async getEnvConfig() {
    return this.request('/env', {}, this.baseURL);
  }

  // Dashboard endpoints
  async getDashboard() {
    return this.request('/dashboard');
  }

    // Incident endpoints (PagerDuty-style)
  async getIncidents(queryString = '', filters = {}) {
    // Build query parameters from filters object
    const params = new URLSearchParams();
    
    // Add legacy queryString support
    if (queryString) {
      params.append('status', queryString.replace('status=', ''));
    }
    
    // Add filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== '') {
        // Map frontend filter keys to backend parameter names
        const paramKey = key === 'service' ? 'service_id' : 
                        key === 'group' ? 'group_id' : 
                        key === 'assignedTo' ? 'assigned_to' : 
                        key === 'timeRange' ? 'time_range' : key;
        params.append(paramKey, value);
      }
    });
    
    const queryStr = params.toString();
    return this.request(`/incidents${queryStr ? `?${queryStr}` : ''}`);
  }

  async getIncident(incidentId) {
    return this.request(`/incidents/${incidentId}`);
  }

  async createIncident(incidentData) {
    return this.request('/incidents', {
      method: 'POST',
      body: JSON.stringify(incidentData)
    });
  }

  async updateIncident(incidentId, incidentData) {
    return this.request(`/incidents/${incidentId}`, {
      method: 'PUT',
      body: JSON.stringify(incidentData)
    });
  }

  async acknowledgeIncident(incidentId, note = '') {
    return this.request(`/incidents/${incidentId}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
  }

  async resolveIncident(incidentId, note = '', resolution = '') {
    return this.request(`/incidents/${incidentId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ note, resolution })
    });
  }

  async escalateIncident(incidentId) {
    return this.request(`/incidents/${incidentId}/escalate`, {
      method: 'POST'
    });
  }

  async assignIncident(incidentId, assignedTo, note = '') {
    return this.request(`/incidents/${incidentId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assigned_to: assignedTo, note })
    });
  }

  async addIncidentNote(incidentId, note) {
    return this.request(`/incidents/${incidentId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
  }

  async getIncidentEvents(incidentId) {
    return this.request(`/incidents/${incidentId}/events`);
  }

  async getIncidentStats() {
    return this.request('/incidents/stats');
  }

  async getRecentIncidents(limit = 5) {
    return this.request(`/incidents?limit=${limit}&sort=created_at_desc`);
  }

  // Legacy Alert endpoints (for backward compatibility)
  async getAlerts(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.severity) params.append('severity', filters.severity);
    if (filters.status) params.append('status', filters.status);
    if (filters.sort) params.append('sort', filters.sort);
    
    // Add label filters
    if (filters.labels) {
      Object.entries(filters.labels).forEach(([key, value]) => {
        params.append(`label_${key}`, value);
      });
    }

    const queryString = params.toString();
    return this.request(`/alerts${queryString ? `?${queryString}` : ''}`);
  }

  async getRecentAlerts(limit = 5) {
    return this.request(`/alerts?limit=${limit}&sort=created_at&order=desc`);
  }

  async getAlertStats() {
    return this.request('/alerts/stats');
  }

  async acknowledgeAlert(alertId) {
    return this.request(`/alerts/${alertId}/ack`, {
      method: 'POST'
    });
  }

  async unacknowledgeAlert(alertId) {
    return this.request(`/alerts/${alertId}/unack`, {
      method: 'POST'
    });
  }

  async resolveAlert(alertId) {
    return this.request(`/alerts/${alertId}/close`, {
      method: 'POST'
    });
  }

  async getAlert(alertId) {
    return this.request(`/alerts/${alertId}`);
  }

  // Group endpoints
  // Main endpoint - returns user-scoped groups (groups user belongs to + public groups)
  async getGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.type) params.append('type', filters.type);
    if (filters.status === 'active') params.append('active_only', 'true');
    if (filters.status === 'inactive') params.append('active_only', 'false');
    if (filters.sort) params.append('sort', filters.sort);
    
    const queryString = params.toString();
    return this.request(`/groups${queryString ? `?${queryString}` : ''}`);
  }

  // Get only groups that the user is a member of
  async getMyGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.append('type', filters.type);
    
    const queryString = params.toString();
    return this.request(`/groups/my${queryString ? `?${queryString}` : ''}`);
  }

  // Get public groups that user can discover and join
  async getPublicGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.append('type', filters.type);
    
    const queryString = params.toString();
    return this.request(`/groups/public${queryString ? `?${queryString}` : ''}`);
  }

  // Admin only - get all groups in the system
  async getAllGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.type) params.append('type', filters.type);
    if (filters.status === 'active') params.append('active_only', 'true');
    if (filters.status === 'inactive') params.append('active_only', 'false');
    if (filters.sort) params.append('sort', filters.sort);
    
    const queryString = params.toString();
    return this.request(`/groups/all${queryString ? `?${queryString}` : ''}`);
  }

  async getGroup(groupId) {
    return this.request(`/groups/${groupId}`);
  }

  async getGroupWithMembers(groupId) {
    return this.request(`/groups/${groupId}/with-members`);
  }

  async getGroupMembers(groupId) {
    return this.request(`/groups/${groupId}/members`);
  }

  async createGroup(groupData) {
    return this.request('/groups', {
      method: 'POST',
      body: JSON.stringify(groupData)
    });
  }

  async updateGroup(groupId, groupData) {
    return this.request(`/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(groupData)
    });
  }

  async deleteGroup(groupId) {
    return this.request(`/groups/${groupId}`, {
      method: 'DELETE'
    });
  }

  async addGroupMember(groupId, memberData) {
    return this.request(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify(memberData)
    });
  }

  async updateGroupMember(groupId, memberId, memberData) {
    return this.request(`/groups/${groupId}/members/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify(memberData)
    });
  }

  async removeGroupMember(groupId, memberId) {
    return this.request(`/groups/${groupId}/members/${memberId}`, {
      method: 'DELETE'
    });
  }

  // Simple GitHub-style user search
  async searchUsers(filters = {}) {
    const params = new URLSearchParams();
    
    if (filters.query) params.append('q', filters.query);
    if (filters.excludeUserIds?.length) {
      params.append('exclude', filters.excludeUserIds.join(','));
    }
    if (filters.limit) params.append('limit', filters.limit.toString());
    
    const queryString = params.toString();
    return this.request(`/users/search${queryString ? `?${queryString}` : ''}`);
  }

  async getGroupStats() {
    return this.request('/groups/stats');
  }

  // NEW: Scheduler endpoints (Scheduler + Shifts architecture)
  async getGroupSchedulers(groupId) {
    return this.request(`/groups/${groupId}/schedulers`);
  }

  async createSchedulerWithShifts(groupId, data) {
    return this.request(`/groups/${groupId}/schedulers/with-shifts`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // OPTIMIZED: Create scheduler with shifts using optimized endpoint
  async createSchedulerWithShiftsOptimized(groupId, data) {
    return this.request(`/groups/${groupId}/schedulers/with-shifts-optimized`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Get scheduler performance statistics
  async getSchedulerPerformanceStats(groupId) {
    return this.request(`/groups/${groupId}/schedulers/stats`);
  }

  // Benchmark scheduler creation performance
  async benchmarkSchedulerCreation(groupId, data) {
    return this.request(`/groups/${groupId}/schedulers/benchmark`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getSchedulerWithShifts(groupId, schedulerId) {
    return this.request(`/groups/${groupId}/schedulers/${schedulerId}`);
  }

  async deleteScheduler(groupId, schedulerId) {
    return this.request(`/groups/${groupId}/schedulers/${schedulerId}`, {
      method: 'DELETE'
    });
  }

  // Legacy: OnCall Schedule endpoints (Individual shifts)
  async getGroupSchedules(groupId) {
    return this.request(`/groups/${groupId}/schedules`);
  }

  async getUpcomingSchedules(groupId, days = 7) {
    const params = new URLSearchParams();
    if (days !== 7) params.append('days', days.toString());
    
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules/upcoming${queryString ? `?${queryString}` : ''}`);
  }

  async createSchedule(groupId, scheduleData) {
    return this.request(`/groups/${groupId}/schedules`, {
      method: 'POST',
      body: JSON.stringify(scheduleData)
    });
  }

  async updateSchedule(scheduleId, scheduleData) {
    return this.request(`/schedules/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify(scheduleData)
    });
  }

  async deleteSchedule(scheduleId) {
    return this.request(`/schedules/${scheduleId}`, {
      method: 'DELETE'
    });
  }

  // Rotation Cycle endpoints (automatic rotations)
  async getGroupRotationCycles(groupId) {
    return this.request(`/groups/${groupId}/rotations`);
  }

  async createRotationCycle(groupId, rotationData) {
    return this.request(`/groups/${groupId}/rotations`, {
      method: 'POST',
      body: JSON.stringify(rotationData)
    });
  }

  async getRotationCycle(rotationId) {
    return this.request(`/rotations/${rotationId}`);
  }

  async getRotationPreview(rotationId, weeks = 4) {
    const params = new URLSearchParams();
    if (weeks !== 4) params.append('weeks', weeks.toString());
    
    const queryString = params.toString();
    return this.request(`/rotations/${rotationId}/preview${queryString ? `?${queryString}` : ''}`);
  }

  async getCurrentRotationMember(rotationId) {
    return this.request(`/rotations/${rotationId}/current`);
  }

  async deactivateRotationCycle(rotationId) {
    return this.request(`/rotations/${rotationId}`, {
      method: 'DELETE'
    });
  }

  async createScheduleOverride(overrideData) {
    return this.request('/rotations/override', {
      method: 'POST',
      body: JSON.stringify(overrideData)
    });
  }

  // Override endpoints (dedicated override system)
  async createOverride(groupId, overrideData) {
    return this.request(`/groups/${groupId}/overrides`, {
      method: 'POST',
      body: JSON.stringify(overrideData)
    });
  }

  async getGroupOverrides(groupId) {
    return this.request(`/groups/${groupId}/overrides`);
  }

  async deleteOverride(groupId, overrideId) {
    return this.request(`/groups/${groupId}/overrides/${overrideId}`, {
      method: 'DELETE'
    });
  }

  // Uptime endpoints
  async getServices(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.type) params.append('type', filters.type);
    if (filters.status) params.append('status', filters.status);
    if (filters.sort) params.append('sort', filters.sort);
    
    const queryString = params.toString();
    return this.request(`/services${queryString ? `?${queryString}` : ''}`);
  }

  async getService(serviceId) {
    return this.request(`/services/${serviceId}`);
  }

  async createService(serviceData) {
    return this.request('/services', {
      method: 'POST',
      body: JSON.stringify(serviceData)
    });
  }

  async updateService(serviceId, serviceData) {
    return this.request(`/services/${serviceId}`, {
      method: 'PUT',
      body: JSON.stringify(serviceData)
    });
  }

  async deleteService(serviceId) {
    return this.request(`/services/${serviceId}`, {
      method: 'DELETE'
    });
  }

  async checkService(serviceId) {
    return this.request(`/services/${serviceId}/check`, {
      method: 'POST'
    });
  }

  async getServiceStats(serviceId, period = '24h') {
    return this.request(`/services/${serviceId}/stats?period=${period}`);
  }

  async getServiceHistory(serviceId, hours = 24) {
    return this.request(`/services/${serviceId}/history?hours=${hours}`);
  }

  async getUptimeDashboard() {
    return this.request('/uptime/dashboard');
  }

  async getUptimeStats() {
    return this.request('/uptime/stats');
  }

  // User endpoints
  async getCurrentOnCallUser() {
    return this.request('/oncall/current');
  }

  async getUsers() {
    return this.request('/users');
  }

  // API Key endpoints
  async getAPIKeys() {
    return this.request('/api-keys');
  }

  async getAPIKey(keyId) {
    return this.request(`/api-keys/${keyId}`);
  }

  async createAPIKey(keyData) {
    return this.request('/api-keys', {
      method: 'POST',
      body: JSON.stringify(keyData)
    });
  }

  async updateAPIKey(keyId, keyData) {
    return this.request(`/api-keys/${keyId}`, {
      method: 'PUT',
      body: JSON.stringify(keyData)
    });
  }

  async deleteAPIKey(keyId) {
    return this.request(`/api-keys/${keyId}`, {
      method: 'DELETE'
    });
  }

  async regenerateAPIKey(keyId) {
    return this.request(`/api-keys/${keyId}/regenerate`, {
      method: 'POST'
    });
  }

  async getAPIKeyStats() {
    return this.request('/api-keys/stats');
  }

  async getAPIKeyUsageLogs(keyId) {
    return this.request(`/api-keys/${keyId}/usage`);
  }

  // Schedule endpoints
  async getGroupSchedules(groupId) {
    return this.request(`/groups/${groupId}/schedules`);
  }

  async createSchedule(groupId, scheduleData) {
    return this.request(`/groups/${groupId}/schedules`, {
      method: 'POST',
      body: JSON.stringify(scheduleData)
    });
  }

  async getSchedulerWithShifts(groupId, schedulerId) {
    return this.request(`/groups/${groupId}/schedulers/${schedulerId}`);
  }

  async getGroupShifts(groupId) {
    return this.request(`/groups/${groupId}/shifts`);
  }

  async updateSchedule(groupId, scheduleId, scheduleData) {
    return this.request(`/groups/${groupId}/schedules/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify(scheduleData)
    });
  }

  async deleteSchedule(groupId, scheduleId) {
    return this.request(`/groups/${groupId}/schedules/${scheduleId}`, {
      method: 'DELETE'
    });
  }

  async getCurrentOnCall(groupId) {
    return this.request(`/groups/${groupId}/oncall/current`);
  }

  async getScheduleHistory(groupId, limit = 50) {
    return this.request(`/groups/${groupId}/schedules/history?limit=${limit}`);
  }

  // Label and filtering endpoints
  async getAvailableLabels() {
    return this.request('/alerts/labels');
  }

  async getAlertsByLabels(labels = {}) {
    const params = new URLSearchParams();
    Object.entries(labels).forEach(([key, value]) => {
      params.append(`label_${key}`, value);
    });
    
    const queryString = params.toString();
    return this.request(`/alerts/by-labels${queryString ? `?${queryString}` : ''}`);
  }

  async getUserPreferences() {
    return this.request('/user/preferences');
  }

  async updateUserPreferences(preferences) {
    return this.request('/user/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences)
    });
  }

  // Service Management endpoints
  async getGroupServices(groupId) {
    return this.request(`/groups/${groupId}/services`);
  }

  async createService(groupId, serviceData) {
    return this.request(`/groups/${groupId}/services`, {
      method: 'POST',
      body: JSON.stringify(serviceData)
    });
  }

  async getService(serviceId) {
    return this.request(`/services/${serviceId}`);
  }

  async updateService(serviceId, serviceData) {
    return this.request(`/services/${serviceId}`, {
      method: 'PUT',
      body: JSON.stringify(serviceData)
    });
  }

  async deleteService(serviceId) {
    return this.request(`/services/${serviceId}`, {
      method: 'DELETE'
    });
  }

  async getServiceByRoutingKey(routingKey) {
    return this.request(`/services/by-routing-key/${routingKey}`);
  }

  async getAllServices() {
    return this.request('/services');
  }

  // ===========================
  // INTEGRATION MANAGEMENT APIs
  // ===========================

  // Integration CRUD operations
  async getIntegrations(filters = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.append('type', filters.type);
    if (filters.active_only) params.append('active_only', 'true');
    
    const queryString = params.toString();
    return this.request(`/integrations${queryString ? `?${queryString}` : ''}`);
  }

  async getIntegration(integrationId) {
    return this.request(`/integrations/${integrationId}`);
  }

  async createIntegration(integrationData) {
    return this.request('/integrations', {
      method: 'POST',
      body: JSON.stringify(integrationData)
    });
  }

  async updateIntegration(integrationId, integrationData) {
    return this.request(`/integrations/${integrationId}`, {
      method: 'PUT',
      body: JSON.stringify(integrationData)
    });
  }

  async deleteIntegration(integrationId) {
    return this.request(`/integrations/${integrationId}`, {
      method: 'DELETE'
    });
  }

  // Integration health monitoring
  async updateIntegrationHeartbeat(integrationId) {
    return this.request(`/integrations/${integrationId}/heartbeat`, {
      method: 'POST'
    });
  }

  async getIntegrationHealth() {
    return this.request('/integrations/health');
  }

  // Integration templates
  async getIntegrationTemplates(type = null) {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    
    const queryString = params.toString();
    return this.request(`/integrations/templates${queryString ? `?${queryString}` : ''}`);
  }

  // Service-Integration mappings
  async getServiceIntegrations(serviceId) {
    return this.request(`/services/${serviceId}/integrations`);
  }

  async createServiceIntegration(serviceId, mappingData) {
    return this.request(`/services/${serviceId}/integrations`, {
      method: 'POST',
      body: JSON.stringify(mappingData)
    });
  }

  async getIntegrationServices(integrationId) {
    return this.request(`/integrations/${integrationId}/services`);
  }

  async updateServiceIntegration(serviceIntegrationId, mappingData) {
    return this.request(`/service-integrations/${serviceIntegrationId}`, {
      method: 'PUT',
      body: JSON.stringify(mappingData)
    });
  }

  async deleteServiceIntegration(serviceIntegrationId) {
    return this.request(`/service-integrations/${serviceIntegrationId}`, {
      method: 'DELETE'
    });
  }

  // Escalation Policy Management endpoints
  async getGroupEscalationPolicies(groupId) {
    return this.request(`/groups/${groupId}/escalation-policies`);
  }

  async createEscalationPolicy(groupId, policyData) {
    return this.request(`/groups/${groupId}/escalation-policies`, {
      method: 'POST',
      body: JSON.stringify({
        ...policyData,
        group_id: groupId
      })
    });
  }

  async getEscalationPolicy(policyId) {
    return this.request(`/escalation/policies/${policyId}`);
  }

  // Group-based Escalation Policy Management (duplicates removed)
  async getGroupEscalationPolicies(groupId) {
    return this.request(`/groups/${groupId}/escalation-policies`);
  }

  async getEscalationPolicy(groupId, policyId) {
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}`);
  }

  async updateEscalationPolicy(groupId, policyId, policyData) {
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}`, {
      method: 'PUT',
      body: JSON.stringify(policyData)
    });
  }

  async deleteEscalationPolicy(groupId, policyId) {
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}`, {
      method: 'DELETE'
    });
  }

  async getEscalationLevels(groupId, policyId) {
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}/levels`);
  }

  async getEscalationPolicyDetail(groupId, policyId) {
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}/detail`);
  }

  async createEscalationLevel(levelData) {
    return this.request(`/escalation/levels`, {
      method: 'POST',
      body: JSON.stringify(levelData)
    });
  }

  async updateEscalationLevel(levelId, levelData) {
    return this.request(`/escalation/levels/${levelId}`, {
      method: 'PUT',
      body: JSON.stringify(levelData)
    });
  }

  async deleteEscalationLevel(levelId) {
    return this.request(`/escalation/levels/${levelId}`, {
      method: 'DELETE'
    });
  }

  async getServicesByEscalationPolicy(policyId) {
    return this.request(`/escalation/rules/${policyId}/services`);
  }


  async getSchedulesByScope(groupId, scope, serviceId = null) {
    const params = new URLSearchParams();
    params.append('scope', scope);
    if (serviceId) params.append('service_id', serviceId);
    
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules-by-scope${queryString ? `?${queryString}` : ''}`);
  }

  async getEffectiveScheduleForService(groupId, serviceId) {
    return this.request(`/groups/${groupId}/services/${serviceId}/effective-schedule`);
  }

  async createServiceSchedule(groupId, serviceId, scheduleData) {
    return this.request(`/groups/${groupId}/services/${serviceId}/schedules`, {
      method: 'POST',
      body: JSON.stringify(scheduleData)
    });
  }

  // Shift Swap endpoints
  async swapSchedules(groupId, swapRequest) {
    return this.request(`/groups/${groupId}/schedules/swap`, {
      method: 'POST',
      body: JSON.stringify(swapRequest)
    });
  }

  // ===========================
  // NOTIFICATION CONFIGURATION APIs
  // ===========================

  // Get user notification configuration
  async getUserNotificationConfig(userId) {
    return this.request(`/users/${userId}/notifications/config`);
  }

  // Update user notification configuration
  async updateUserNotificationConfig(userId, configData) {
    return this.request(`/users/${userId}/notifications/config`, {
      method: 'PUT',
      body: JSON.stringify(configData)
    });
  }

  // Test Slack notification
  async testSlackNotification(userId) {
    return this.request(`/users/${userId}/notifications/test/slack`, {
      method: 'POST'
    });
  }

  // Get notification statistics
  async getUserNotificationStats(userId) {
    return this.request(`/users/${userId}/notifications/stats`);
  }

  // Get current user info
  async getCurrentUser() {
    return this.request('/user/me');
  }

  // Update current user profile
  async updateCurrentUser(userData) {
    return this.request('/user/me', {
      method: 'PUT',
      body: JSON.stringify(userData)
    });
  }

  // ===========================
  // AI AGENT APIs (port 8002)
  // ===========================

  // Get chat history
  async getChatHistory() {
    return this.request('/history', {}, this.aiBaseURL);
  }

  // Get session-specific chat history
  async getSessionHistory(sessionId) {
    return this.request(`/sessions/${sessionId}/history`, {}, this.aiBaseURL);
  }

  // Get session information
  async getSessionInfo(sessionId) {
    return this.request(`/sessions/${sessionId}`, {}, this.aiBaseURL);
  }

  // Load session from disk
  async loadSession(sessionId) {
    return this.request(`/sessions/${sessionId}/load`, {
      method: 'POST'
    }, this.aiBaseURL);
  }

  // List all active sessions
  async listSessions() {
    return this.request('/sessions', {}, this.aiBaseURL);
  }

  // Stop streaming session
  async stopSession(sessionId) {
    return this.request(`/sessions/${sessionId}/stop`, {
      method: 'POST'
    }, this.aiBaseURL);
  }

  // Reset session team
  async resetSession(sessionId) {
    return this.request(`/sessions/${sessionId}/reset`, {
      method: 'POST'
    }, this.aiBaseURL);
  }

  // Delete session
  async deleteSession(sessionId) {
    return this.request(`/sessions/${sessionId}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  // ===========================
  // RUNBOOK APIs (port 8002)
  // ===========================

  // Get runbook statistics
  async getRunbookStats() {
    return this.request('/runbook/stats', {}, this.aiBaseURL);
  }

  // List indexed runbook documents
  async listRunbookDocuments() {
    return this.request('/runbook/list-documents', {}, this.aiBaseURL);
  }

  // Index runbooks from GitHub
  async indexRunbooksFromGithub(githubUrl, userId) {
    return this.request('/runbook/index-github', {
      method: 'POST',
      body: JSON.stringify({
        github_url: githubUrl,
        user_id: userId
      })
    }, this.aiBaseURL);
  }

  // Reindex all runbooks
  async reindexRunbooks() {
    return this.request('/runbook/reindex', {
      method: 'POST'
    }, this.aiBaseURL);
  }

  // Test runbook retrieval
  async testRunbookRetrieval() {
    return this.request('/runbook/test', {}, this.aiBaseURL);
  }
}

export const apiClient = new APIClient();
export default apiClient;
