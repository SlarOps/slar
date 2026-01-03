// API client for SLAR backend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
export const AI_BASE_URL = process.env.NEXT_PUBLIC_AI_API_URL || '/ai';

class APIClient {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.aiBaseURL = AI_BASE_URL;
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  // Helper: Build ReBAC query params (org_id MANDATORY, project_id OPTIONAL)
  _buildReBACParams(filters = {}, params = new URLSearchParams()) {
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    return params;
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
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getDashboard(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/dashboard${queryString ? `?${queryString}` : ''}`);
  }

  // Incident endpoints (PagerDuty-style)
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getIncidents(queryString = '', filters = {}) {
    // Build query parameters from filters object
    const params = new URLSearchParams();

    // ReBAC: org_id MANDATORY, project_id OPTIONAL
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);

    // Add legacy queryString support
    if (queryString) {
      params.append('status', queryString.replace('status=', ''));
    }

    // Add filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== '' && key !== 'org_id' && key !== 'project_id') {
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

  // ReBAC: org_id is required for tenant isolation
  async getIncident(incidentId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: incidentData should include organization_id (required) and project_id (optional)
  async createIncident(incidentData) {
    return this.request('/incidents', {
      method: 'POST',
      body: JSON.stringify(incidentData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async updateIncident(incidentId, incidentData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(incidentData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async acknowledgeIncident(incidentId, note = '', filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}/acknowledge${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async resolveIncident(incidentId, note = '', resolution = '', filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}/resolve${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({ note, resolution })
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async escalateIncident(incidentId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}/escalate${queryString ? `?${queryString}` : ''}`, {
      method: 'POST'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async assignIncident(incidentId, assignedTo, note = '', filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}/assign${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({ assigned_to: assignedTo, note })
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async addIncidentNote(incidentId, note, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}/notes${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getIncidentEvents(incidentId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/${incidentId}/events${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getIncidentStats(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/incidents/stats${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getRecentIncidents(limit = 5, filters = {}) {
    const params = this._buildReBACParams(filters);
    params.append('limit', limit.toString());
    params.append('sort', 'created_at_desc');
    const queryString = params.toString();
    return this.request(`/incidents${queryString ? `?${queryString}` : ''}`);
  }

  // Legacy Alert endpoints (for backward compatibility)
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getAlerts(filters = {}) {
    const params = new URLSearchParams();
    // ReBAC: org_id MANDATORY, project_id OPTIONAL
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
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

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getRecentAlerts(limit = 5, filters = {}) {
    const params = this._buildReBACParams(filters);
    params.append('limit', limit.toString());
    params.append('sort', 'created_at');
    params.append('order', 'desc');
    const queryString = params.toString();
    return this.request(`/alerts${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getAlertStats(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/alerts/stats${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async acknowledgeAlert(alertId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/alerts/${alertId}/ack${queryString ? `?${queryString}` : ''}`, {
      method: 'POST'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async unacknowledgeAlert(alertId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/alerts/${alertId}/unack${queryString ? `?${queryString}` : ''}`, {
      method: 'POST'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async resolveAlert(alertId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/alerts/${alertId}/close${queryString ? `?${queryString}` : ''}`, {
      method: 'POST'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getAlert(alertId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/alerts/${alertId}${queryString ? `?${queryString}` : ''}`);
  }

  // Group endpoints
  // Main endpoint - returns user-scoped groups (groups user belongs to + public groups)
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.search) params.append('search', filters.search);
    if (filters.type) params.append('type', filters.type);
    if (filters.status === 'active') params.append('active_only', 'true');
    if (filters.status === 'inactive') params.append('active_only', 'false');
    if (filters.sort) params.append('sort', filters.sort);

    const queryString = params.toString();
    return this.request(`/groups${queryString ? `?${queryString}` : ''}`);
  }

  // Get only groups that the user is a member of
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getMyGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.type) params.append('type', filters.type);

    const queryString = params.toString();
    return this.request(`/groups/my${queryString ? `?${queryString}` : ''}`);
  }

  // Get public groups that user can discover and join
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getPublicGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.type) params.append('type', filters.type);

    const queryString = params.toString();
    return this.request(`/groups/public${queryString ? `?${queryString}` : ''}`);
  }

  // Admin only - get all groups in the system
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getAllGroups(filters = {}) {
    const params = new URLSearchParams();
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.search) params.append('search', filters.search);
    if (filters.type) params.append('type', filters.type);
    if (filters.status === 'active') params.append('active_only', 'true');
    if (filters.status === 'inactive') params.append('active_only', 'false');
    if (filters.sort) params.append('sort', filters.sort);

    const queryString = params.toString();
    return this.request(`/groups/all${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getGroup(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getGroupWithMembers(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/with-members${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getGroupMembers(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/members${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: groupData should include organization_id (required) and project_id (optional)
  async createGroup(groupData) {
    return this.request('/groups', {
      method: 'POST',
      body: JSON.stringify(groupData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async updateGroup(groupId, groupData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(groupData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteGroup(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async addGroupMember(groupId, memberData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/members${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(memberData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async updateGroupMember(groupId, memberId, memberData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/members/${memberId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(memberData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async removeGroupMember(groupId, memberId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/members/${memberId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // Simple GitHub-style user search
  // ReBAC: org_id is required for tenant isolation
  async searchUsers(filters = {}) {
    const params = new URLSearchParams();
    // ReBAC: org_id MANDATORY
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);

    if (filters.query) params.append('q', filters.query);
    if (filters.excludeUserIds?.length) {
      params.append('exclude', filters.excludeUserIds.join(','));
    }
    if (filters.limit) params.append('limit', filters.limit.toString());

    const queryString = params.toString();
    return this.request(`/users/search${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getGroupStats(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/stats${queryString ? `?${queryString}` : ''}`);
  }

  // NEW: Scheduler endpoints (Scheduler + Shifts architecture)
  // ReBAC: org_id is required for tenant isolation
  async getGroupSchedulers(groupId, filters = {}) {
    const params = new URLSearchParams();
    // ReBAC: org_id is MANDATORY for tenant isolation
    if (filters.org_id) params.append('org_id', filters.org_id);
    // ReBAC: project_id is OPTIONAL for Computed Scope
    if (filters.project_id) params.append('project_id', filters.project_id);

    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: data should include organization_id (required) and project_id (optional)
  async createSchedulerWithShifts(groupId, data, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers/with-shifts${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // OPTIMIZED: Create scheduler with shifts using optimized endpoint
  // ReBAC: data should include organization_id (required) and project_id (optional)
  async createSchedulerWithShiftsOptimized(groupId, data, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers/with-shifts${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Get scheduler performance statistics
  // ReBAC: org_id is required for tenant isolation
  async getSchedulerPerformanceStats(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers/stats${queryString ? `?${queryString}` : ''}`);
  }

  // Benchmark scheduler creation performance
  async benchmarkSchedulerCreation(groupId, data, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers/benchmark${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getSchedulerWithShifts(groupId, schedulerId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers/${schedulerId}${queryString ? `?${queryString}` : ''}`);
  }

  async updateSchedulerWithShifts(groupId, schedulerId, data) {
    return this.request(`/groups/${groupId}/schedulers/${schedulerId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteScheduler(groupId, schedulerId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers/${schedulerId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // Legacy: OnCall Schedule endpoints (Individual shifts)
  // ReBAC: org_id is required for tenant isolation
  async getGroupSchedules(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getUpcomingSchedules(groupId, days = 7, filters = {}) {
    const params = this._buildReBACParams(filters);
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

  // ReBAC: org_id is required for tenant isolation
  async deleteSchedule(scheduleId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/schedules/${scheduleId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // Rotation Cycle endpoints (automatic rotations)
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getGroupRotationCycles(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/rotations${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: rotationData should include organization_id (required) and project_id (optional)
  async createRotationCycle(groupId, rotationData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/rotations${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(rotationData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getRotationCycle(rotationId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/rotations/${rotationId}${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getRotationPreview(rotationId, weeks = 4, filters = {}) {
    const params = this._buildReBACParams(filters);
    if (weeks !== 4) params.append('weeks', weeks.toString());

    const queryString = params.toString();
    return this.request(`/rotations/${rotationId}/preview${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getCurrentRotationMember(rotationId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/rotations/${rotationId}/current${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async deactivateRotationCycle(rotationId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/rotations/${rotationId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // ReBAC: overrideData should include organization_id (required) and project_id (optional)
  async createScheduleOverride(overrideData) {
    return this.request('/rotations/override', {
      method: 'POST',
      body: JSON.stringify(overrideData)
    });
  }

  // Override endpoints (dedicated override system)
  // ReBAC: overrideData should include organization_id (required) and project_id (optional)
  async createOverride(groupId, overrideData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/overrides${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(overrideData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getGroupOverrides(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/overrides${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteOverride(groupId, overrideId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/overrides/${overrideId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // Uptime endpoints
  // Service endpoints
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getServices(filters = {}) {
    const params = new URLSearchParams();
    // ReBAC: org_id is MANDATORY for tenant isolation
    if (filters.org_id) params.append('org_id', filters.org_id);
    // ReBAC: project_id is OPTIONAL for Computed Scope
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.search) params.append('search', filters.search);
    if (filters.type) params.append('type', filters.type);
    if (filters.group_id) params.append('group_id', filters.group_id);
    if (filters.status === 'active') params.append('is_active', 'true');
    if (filters.status === 'inactive') params.append('is_active', 'false');
    if (filters.sort) params.append('sort', filters.sort);

    const queryString = params.toString();
    return this.request(`/services${queryString ? `?${queryString}` : ''}`);
  }

  async getService(serviceId) {
    return this.request(`/services/${serviceId}`);
  }

  // ReBAC: serviceData should include organization_id (required) and project_id (optional)
  async createService(groupId, serviceData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/services${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(serviceData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async updateService(serviceId, serviceData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/${serviceId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(serviceData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteService(serviceId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/${serviceId}${queryString ? `?${queryString}` : ''}`, {
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

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getUptimeDashboard(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/uptime/dashboard${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getUptimeStats(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/uptime/stats${queryString ? `?${queryString}` : ''}`);
  }

  // User endpoints
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getCurrentOnCallUser(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/oncall/current${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getUsers(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/users${queryString ? `?${queryString}` : ''}`);
  }


  // Schedule endpoints (duplicated - kept for legacy compatibility)
  // Note: Primary schedule methods are defined earlier in this file
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getGroupSchedulesLegacy(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: scheduleData should include organization_id (required) and project_id (optional)
  async createScheduleLegacy(groupId, scheduleData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(scheduleData)
    });
  }

  // ReBAC: org_id is required for tenant isolation (duplicate of getSchedulerWithShifts above)
  async getSchedulerWithShiftsLegacy(groupId, schedulerId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedulers/${schedulerId}${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getGroupShifts(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/shifts${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async updateScheduleLegacy(groupId, scheduleId, scheduleData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules/${scheduleId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(scheduleData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteScheduleLegacy(groupId, scheduleId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules/${scheduleId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getCurrentOnCall(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/oncall/current${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getScheduleHistory(groupId, limit = 50, filters = {}) {
    const params = this._buildReBACParams(filters);
    params.append('limit', limit.toString());
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules/history${queryString ? `?${queryString}` : ''}`);
  }

  // Label and filtering endpoints
  // ReBAC: org_id is required for tenant isolation
  async getAvailableLabels(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/alerts/labels${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getAlertsByLabels(labels = {}, filters = {}) {
    const params = this._buildReBACParams(filters);
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
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getGroupServices(groupId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/services${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: serviceData should include organization_id (required) and project_id (optional)
  async createServiceForGroup(groupId, serviceData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/services${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(serviceData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getServiceById(serviceId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/${serviceId}${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async updateServiceById(serviceId, serviceData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/${serviceId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(serviceData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteServiceById(serviceId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/${serviceId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getServiceByRoutingKey(routingKey, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/by-routing-key/${routingKey}${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getAllServices(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services${queryString ? `?${queryString}` : ''}`);
  }

  // ===========================
  // INTEGRATION MANAGEMENT APIs
  // ===========================

  // Integration CRUD operations
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getIntegrations(filters = {}) {
    const params = new URLSearchParams();
    // ReBAC: org_id is MANDATORY for tenant isolation
    if (filters.org_id) params.append('org_id', filters.org_id);
    // ReBAC: project_id is OPTIONAL for Computed Scope
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.type) params.append('type', filters.type);
    if (filters.active_only) params.append('active_only', 'true');

    const queryString = params.toString();
    return this.request(`/integrations${queryString ? `?${queryString}` : ''}`);
  }

  async getIntegration(integrationId) {
    return this.request(`/integrations/${integrationId}`);
  }

  // ReBAC: integrationData should include organization_id (required) and project_id (optional)
  async createIntegration(integrationData) {
    return this.request('/integrations', {
      method: 'POST',
      body: JSON.stringify(integrationData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async updateIntegration(integrationId, integrationData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/integrations/${integrationId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(integrationData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteIntegration(integrationId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/integrations/${integrationId}${queryString ? `?${queryString}` : ''}`, {
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
  // ReBAC: org_id is required for tenant isolation
  async getServiceIntegrations(serviceId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/${serviceId}/integrations${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: mappingData should include organization_id (required) and project_id (optional)
  async createServiceIntegration(serviceId, mappingData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/services/${serviceId}/integrations${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(mappingData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getIntegrationServices(integrationId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/integrations/${integrationId}/services${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async updateServiceIntegration(serviceIntegrationId, mappingData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/service-integrations/${serviceIntegrationId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(mappingData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteServiceIntegration(serviceIntegrationId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/service-integrations/${serviceIntegrationId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // Escalation Policy Management endpoints
  // ReBAC: org_id is required for tenant isolation, project_id is optional
  async getGroupEscalationPolicies(groupId, filters = {}) {
    const params = new URLSearchParams();
    // ReBAC: org_id is MANDATORY for tenant isolation
    if (filters.org_id) params.append('org_id', filters.org_id);
    // ReBAC: project_id is OPTIONAL for Computed Scope
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.active_only !== undefined) params.append('active_only', filters.active_only.toString());

    const queryString = params.toString();
    return this.request(`/groups/${groupId}/escalation-policies${queryString ? `?${queryString}` : ''}`);
  }

  async createEscalationPolicy(groupId, policyData, filters = {}) {
    const params = new URLSearchParams();
    // ReBAC: org_id is MANDATORY for tenant isolation
    if (filters.org_id) params.append('org_id', filters.org_id);

    const queryString = params.toString();
    return this.request(`/groups/${groupId}/escalation-policies${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({
        ...policyData,
        group_id: groupId
      })
    });
  }

  async getEscalationPolicy(groupId, policyId) {
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async updateEscalationPolicy(groupId, policyId, policyData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(policyData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteEscalationPolicy(groupId, policyId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getEscalationLevels(groupId, policyId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}/levels${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getEscalationPolicyDetail(groupId, policyId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/escalation-policies/${policyId}/detail${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: levelData should include organization_id (required) and project_id (optional)
  async createEscalationLevel(levelData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/escalation/levels${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(levelData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async updateEscalationLevel(levelId, levelData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/escalation/levels/${levelId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(levelData)
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async deleteEscalationLevel(levelId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/escalation/levels/${levelId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  // ReBAC: org_id is required for tenant isolation
  async getServicesByEscalationPolicy(policyId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/escalation/rules/${policyId}/services${queryString ? `?${queryString}` : ''}`);
  }


  // ReBAC: org_id is required for tenant isolation
  async getSchedulesByScope(groupId, scope, serviceId = null, filters = {}) {
    const params = this._buildReBACParams(filters);
    params.append('scope', scope);
    if (serviceId) params.append('service_id', serviceId);

    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules-by-scope${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: org_id is required for tenant isolation
  async getEffectiveScheduleForService(groupId, serviceId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/services/${serviceId}/effective-schedule${queryString ? `?${queryString}` : ''}`);
  }

  // ReBAC: scheduleData should include organization_id (required) and project_id (optional)
  async createServiceSchedule(groupId, serviceId, scheduleData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/services/${serviceId}/schedules${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(scheduleData)
    });
  }

  // Shift Swap endpoints
  // ReBAC: org_id is required for tenant isolation
  async swapSchedules(groupId, swapRequest, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/groups/${groupId}/schedules/swap${queryString ? `?${queryString}` : ''}`, {
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
  // MARKETPLACE MANAGEMENT APIs
  // ===========================

  /**
   * Delete marketplace asynchronously via PGMQ
   *
   * This marks the marketplace as "deleting" and enqueues a cleanup task.
   * The background worker will handle actual cleanup (workspace, S3, DB).
   *
   * @param {string} marketplaceName - Name of marketplace to delete
   * @returns {Promise<{success: boolean, message: string, job_id: number}>}
   */
  async deleteMarketplace(marketplaceName) {
    return this.request(`/api/marketplace/${encodeURIComponent(marketplaceName)}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  /**
   * Clone marketplace repository (git clone)
   *
   * Clones marketplace from GitHub using git clone:
   * - Metadata → PostgreSQL (instant reads)
   * - Files → Local workspace via git clone
   *
   * @param {object} data - {owner, repo, branch, marketplace_name}
   * @returns {Promise<{success: boolean, marketplace: object, commit_sha: string}>}
   */
  async cloneMarketplace(data) {
    return this.request('/api/marketplace/clone', {
      method: 'POST',
      body: JSON.stringify(data)
    }, this.aiBaseURL);
  }

  /**
   * Update marketplace repository (git fetch)
   *
   * Performs incremental update using git fetch + reset.
   * Much faster than re-cloning.
   *
   * @param {string} marketplaceName - Marketplace name to update
   * @returns {Promise<{success: boolean, had_changes: boolean, commit_sha: string}>}
   */
  async updateMarketplace(marketplaceName) {
    return this.request('/api/marketplace/update', {
      method: 'POST',
      body: JSON.stringify({
        marketplace_name: marketplaceName
      })
    }, this.aiBaseURL);
  }

  /**
   * Update all marketplaces (git fetch all)
   *
   * Updates all user's marketplaces using git fetch.
   *
   * @returns {Promise<{success: boolean, updated_count: number, results: Array}>}
   */
  async updateAllMarketplaces() {
    return this.request('/api/marketplace/update-all', {
      method: 'POST',
      body: JSON.stringify({})
    }, this.aiBaseURL);
  }

  /**
   * Sync all marketplaces via git fetch
   *
   * Called during sync to update all git-based marketplaces.
   *
   * @returns {Promise<{success: boolean, updated_count: number, results: Array}>}
   */
  async syncMarketplaces() {
    return this.request('/api/sync-marketplaces', {
      method: 'POST',
      body: JSON.stringify({})
    }, this.aiBaseURL);
  }

  /**
   * [DEPRECATED] Download marketplace repository (ZIP + metadata)
   * Use cloneMarketplace() instead for git-based approach.
   *
   * @param {object} data - {owner, repo, branch, marketplace_name}
   * @returns {Promise<{success: boolean, marketplace: object}>}
   */
  async downloadMarketplace(data) {
    // Redirect to clone endpoint
    return this.cloneMarketplace(data);
  }

  /**
   * Install plugin from marketplace
   *
   * Marks plugin as installed in PostgreSQL. Plugin files are already
   * in workspace from git clone.
   *
   * @param {string} marketplaceName - Marketplace name
   * @param {string} pluginName - Plugin name to install
   * @param {string} version - Plugin version
   * @returns {Promise<{success: boolean, plugin: object}>}
   */
  async installPlugin(marketplaceName, pluginName, version = '1.0.0') {
    return this.request('/api/marketplace/install-plugin', {
      method: 'POST',
      body: JSON.stringify({
        marketplace_name: marketplaceName,
        plugin_name: pluginName,
        version: version
      })
    }, this.aiBaseURL);
  }

  // ===========================
  // UPTIME MONITOR APIs
  // ===========================

  /**
   * Get all monitors, optionally filtered by deployment
   * ReBAC: org_id is required for tenant isolation, project_id is optional
   * @param {object} filters - {org_id (required), project_id (optional), deployment_id (optional)}
   * @returns {Promise<Array>} List of monitors
   */
  async getMonitors(filters = {}) {
    const params = this._buildReBACParams(filters);
    if (filters.deployment_id) params.append('deployment_id', filters.deployment_id);

    const queryString = params.toString();
    return this.request(`/monitors${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Get all monitor deployments
   * ReBAC: org_id is required for tenant isolation, project_id is optional
   * @param {object} filters - {org_id (required), project_id (optional)}
   * @returns {Promise<Array>} List of deployments
   */
  async getMonitorDeployments(filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/deployments${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Get worker deployment statistics
   * ReBAC: org_id is required for tenant isolation
   * @param {string} deploymentId - Deployment ID
   * @param {object} filters - {org_id (required), project_id (optional)}
   * @returns {Promise<object>} Worker stats
   */
  async getDeploymentStats(deploymentId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/deployments/${deploymentId}/stats${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Create a new monitor
   * ReBAC: monitorData should include organization_id (required) and project_id (optional)
   * @param {object} monitorData - Monitor configuration with org_id/project_id
   * @returns {Promise<object>} Created monitor
   */
  async createMonitor(monitorData) {
    return this.request('/monitors', {
      method: 'POST',
      body: JSON.stringify(monitorData)
    });
  }

  /**
   * Delete a monitor
   * ReBAC: org_id is required for tenant isolation
   * @param {string} monitorId - Monitor ID
   * @param {object} filters - {org_id (required)}
   * @returns {Promise<object>} Deletion result
   */
  async deleteMonitor(monitorId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/${monitorId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  /**
   * Update a monitor
   * ReBAC: org_id is required for tenant isolation
   * @param {string} monitorId - Monitor ID
   * @param {object} monitorData - Monitor configuration
   * @param {object} filters - {org_id (required)}
   * @returns {Promise<object>} Updated monitor
   */
  async updateMonitor(monitorId, monitorData, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/${monitorId}${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify(monitorData)
    });
  }

  /**
   * Deploy a Cloudflare Worker for monitoring
   * ReBAC: deploymentData should include organization_id (required) and project_id (optional)
   * @param {object} deploymentData - Deployment configuration with org_id/project_id
   * @returns {Promise<object>} Deployment result
   */
  async deployMonitorWorker(deploymentData) {
    return this.request('/monitors/deploy', {
      method: 'POST',
      body: JSON.stringify(deploymentData)
    });
  }

  /**
   * @deprecated Use workerApi.getMonitorStats() instead for faster CDN-cached response
   * Get monitor statistics via Go API (slow: Go → Cloudflare API → D1)
   * @param {string} monitorId - Monitor ID
   * @returns {Promise<object>} Statistics (uptime %, avg latency, total checks)
   */
  async getMonitorStats(monitorId) {
    console.warn('DEPRECATED: getMonitorStats() - Use workerApi.getMonitorStats() for faster response');
    return this.request(`/monitors/${monitorId}/stats`);
  }

  /**
   * @deprecated Use workerApi.getMonitorStats() instead for faster CDN-cached response
   * Get 90-day uptime history via Go API (slow: Go → Cloudflare API → D1)
   * @param {string} monitorId - Monitor ID
   * @returns {Promise<Array>} Daily uptime status
   */
  async getMonitorUptimeHistory(monitorId) {
    console.warn('DEPRECATED: getMonitorUptimeHistory() - Use workerApi.getMonitorStats() for faster response');
    return this.request(`/monitors/${monitorId}/uptime-history`);
  }

  /**
   * @deprecated Use workerApi.getMonitorStats() instead for faster CDN-cached response
   * Get response times for charting via Go API (slow: Go → Cloudflare API → D1)
   * @param {string} monitorId - Monitor ID
   * @param {string} period - Time period (24h, 7d, 30d)
   * @returns {Promise<Array>} Response time data
   */
  async getMonitorResponseTimes(monitorId, period = '24h') {
    console.warn('DEPRECATED: getMonitorResponseTimes() - Use workerApi.getMonitorStats() for faster response');
    return this.request(`/monitors/${monitorId}/response-times?period=${period}`);
  }

  /**
   * Redeploy a monitor worker with latest code
   * ReBAC: org_id is required for tenant isolation
   * @param {string} deploymentId - Deployment ID
   * @param {object} filters - {org_id (required), project_id (optional)}
   * @returns {Promise<object>} Redeploy result
   */
  async redeployMonitorWorker(deploymentId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/deployments/${deploymentId}/redeploy${queryString ? `?${queryString}` : ''}`, {
      method: 'POST'
    });
  }

  /**
   * Delete a monitor deployment
   * ReBAC: org_id is required for tenant isolation
   * @param {string} deploymentId - Deployment ID
   * @param {boolean} keepDatabase - Whether to keep the D1 database
   * @param {object} filters - {org_id (required), project_id (optional)}
   * @returns {Promise<object>} Delete result
   */
  async deleteMonitorDeployment(deploymentId, keepDatabase = true, filters = {}) {
    const params = this._buildReBACParams(filters);
    params.append('keep_database', keepDatabase.toString());
    const queryString = params.toString();
    return this.request(`/monitors/deployments/${deploymentId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE'
    });
  }

  /**
   * Get deployment integration info
   * ReBAC: org_id is required for tenant isolation
   * @param {string} deploymentId - Deployment ID
   * @param {object} filters - {org_id (required), project_id (optional)}
   * @returns {Promise<object>} Integration info
   */
  async getDeploymentIntegration(deploymentId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/deployments/${deploymentId}/integration${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Update deployment integration link
   * ReBAC: org_id is required for tenant isolation
   * @param {string} deploymentId - Deployment ID
   * @param {string|null} integrationId - Integration ID to link (null to unlink)
   * @param {object} filters - {org_id (required), project_id (optional)}
   * @returns {Promise<object>} Update result
   */
  async updateDeploymentIntegration(deploymentId, integrationId, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/deployments/${deploymentId}/integration${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ integration_id: integrationId })
    });
  }

  /**
   * Update worker URL for a deployment
   * ReBAC: org_id is required for tenant isolation
   * @param {string} deploymentId - Deployment ID
   * @param {string} workerUrl - Worker URL (e.g., https://slar-worker.xxx.workers.dev)
   * @param {object} filters - {org_id (required), project_id (optional)}
   * @returns {Promise<object>} Update result
   */
  async updateDeploymentWorkerUrl(deploymentId, workerUrl, filters = {}) {
    const params = this._buildReBACParams(filters);
    const queryString = params.toString();
    return this.request(`/monitors/deployments/${deploymentId}/worker-url${queryString ? `?${queryString}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ worker_url: workerUrl })
    });
  }

  // ===========================
  // WORKER API METHODS (FAST - CDN CACHED)
  // ===========================
  // These methods call the Worker directly for much faster response (~5ms vs ~400ms)

  /**
   * Get all metrics from Worker (CDN cached, ~5ms on cache hit)
   * @param {string} workerUrl - Worker URL (e.g., https://slar-worker.xxx.workers.dev)
   * @returns {Promise<object>} Metrics with all monitors
   */
  async getWorkerMetrics(workerUrl) {
    const response = await fetch(`${workerUrl}/api/metrics`);
    if (!response.ok) throw new Error(`Worker API error: ${response.status}`);
    const data = await response.json();
    return {
      ...data,
      _cache_status: response.headers.get('X-Cache-Status')
    };
  }

  /**
   * Get monitor stats from Worker (CDN cached, ~5ms on cache hit)
   * @param {string} workerUrl - Worker URL
   * @param {string} monitorId - Monitor ID
   * @returns {Promise<object>} Monitor stats with recent logs
   */
  async getWorkerMonitorStats(workerUrl, monitorId) {
    const response = await fetch(`${workerUrl}/api/monitors/${monitorId}`);
    if (!response.ok) throw new Error(`Worker API error: ${response.status}`);
    const data = await response.json();
    return {
      ...data,
      _cache_status: response.headers.get('X-Cache-Status')
    };
  }

  /**
   * Check Worker health
   * @param {string} workerUrl - Worker URL
   * @returns {Promise<object>} Health status
   */
  async checkWorkerHealth(workerUrl) {
    const response = await fetch(`${workerUrl}/health`);
    if (!response.ok) throw new Error(`Worker health check failed: ${response.status}`);
    return response.json();
  }

  // ===========================
  // CLAUDE CONVERSATIONS APIs
  // ===========================

  /**
   * Get user's conversation history for resume functionality
   * @param {object} options - { limit: 20, offset: 0, archived: false }
   * @returns {Promise<object>} { success, conversations: [...], total }
   */
  async getConversations(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());
    if (options.archived) params.append('archived', 'true');

    const queryString = params.toString();
    return this.request(`/api/conversations${queryString ? `?${queryString}` : ''}`, {}, this.aiBaseURL);
  }

  /**
   * Get a specific conversation by ID
   * @param {string} conversationId - Claude conversation ID
   * @returns {Promise<object>} { success, conversation }
   */
  async getConversation(conversationId) {
    return this.request(`/api/conversations/${conversationId}`, {}, this.aiBaseURL);
  }

  /**
   * Get messages for a conversation (for resume/history display)
   * @param {string} conversationId - Claude conversation ID
   * @param {number} limit - Max messages to return (default: 100)
   * @returns {Promise<object>} { success, messages }
   */
  async getConversationMessages(conversationId, limit = 100) {
    return this.request(`/api/conversations/${conversationId}/messages?limit=${limit}`, {}, this.aiBaseURL);
  }

  /**
   * Update conversation metadata (title, archive status)
   * @param {string} conversationId - Claude conversation ID
   * @param {object} data - { title?: string, is_archived?: boolean }
   * @returns {Promise<object>} { success, message }
   */
  async updateConversation(conversationId, data) {
    return this.request(`/api/conversations/${conversationId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }, this.aiBaseURL);
  }

  /**
   * Delete a conversation
   * @param {string} conversationId - Claude conversation ID
   * @returns {Promise<object>} { success, message }
   */
  async deleteConversation(conversationId) {
    return this.request(`/api/conversations/${conversationId}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  // AI Agent endpoints
  async addAllowedTool(toolName) {
    return this.request('/api/allowed-tools', {
      method: 'POST',
      body: JSON.stringify({ tool_name: toolName })
    }, this.aiBaseURL);
  }

  async getAllowedTools() {
    return this.request('/api/allowed-tools', {}, this.aiBaseURL);
  }

  async removeAllowedTool(toolName) {
    return this.request(`/api/allowed-tools?tool_name=${encodeURIComponent(toolName)}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  // ===========================
  // INSTALLED PLUGINS (AI Backend)
  // ===========================

  /**
   * Get all installed plugins for current user
   * @returns {Promise<object>} { success, plugins: [...] }
   */
  async getInstalledPlugins() {
    return this.request('/api/installed-plugins', {}, this.aiBaseURL);
  }

  /**
   * Add or update an installed plugin
   * @param {object} plugin - Plugin data { plugin_name, marketplace_name, plugin_type, config }
   * @returns {Promise<object>} { success, plugin: {...} }
   */
  async addInstalledPlugin(plugin) {
    return this.request('/api/installed-plugins', {
      method: 'POST',
      body: JSON.stringify(plugin)
    }, this.aiBaseURL);
  }

  /**
   * Remove an installed plugin by ID
   * @param {string} pluginId - Plugin UUID to remove
   * @returns {Promise<object>} { success, message }
   */
  async removeInstalledPlugin(pluginId) {
    return this.request(`/api/installed-plugins/${pluginId}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  // ===========================
  // MARKETPLACES (AI Backend)
  // ===========================

  /**
   * Get all marketplaces for current user
   * @returns {Promise<object>} { success, marketplaces: [...] }
   */
  async getAllMarketplaces() {
    return this.request('/api/marketplaces', {}, this.aiBaseURL);
  }

  /**
   * Get a single marketplace by name
   * @param {string} marketplaceName - Name of the marketplace
   * @returns {Promise<object>} { success, marketplace: {...} }
   */
  async getMarketplaceByName(marketplaceName) {
    return this.request(`/api/marketplaces/${encodeURIComponent(marketplaceName)}`, {}, this.aiBaseURL);
  }

  // ===========================
  // MOBILE APP CONNECTION
  // ===========================

  /**
   * Generate QR code data for mobile app connection
   * @returns {Promise<object>} QR code payload
   */
  async generateMobileConnectQR() {
    return this.request('/mobile/connect/generate', {
      method: 'POST'
    });
  }

  /**
   * Get connected mobile devices
   * @returns {Promise<object>} List of connected devices
   */
  async getMobileDevices() {
    return this.request('/mobile/devices');
  }

  /**
   * Disconnect a mobile device
   * @param {string} deviceId - Device ID to disconnect
   * @returns {Promise<object>} Result
   */
  async disconnectMobileDevice(deviceId) {
    return this.request(`/mobile/devices/${deviceId}`, {
      method: 'DELETE'
    });
  }

  // ===========================
  // ORGANIZATION MANAGEMENT APIs
  // ===========================

  /**
   * Get all organizations the user has access to
   * @returns {Promise<Array>} List of organizations
   */
  async getOrganizations() {
    return this.request('/orgs');
  }

  /**
   * Get a specific organization by ID
   * @param {string} orgId - Organization ID
   * @returns {Promise<object>} Organization details
   */
  async getOrganization(orgId) {
    return this.request(`/orgs/${orgId}`);
  }

  /**
   * Create a new organization
   * @param {object} orgData - Organization data {name, description, settings}
   * @returns {Promise<object>} Created organization
   */
  async createOrganization(orgData) {
    return this.request('/orgs', {
      method: 'POST',
      body: JSON.stringify(orgData)
    });
  }

  /**
   * Update an organization
   * @param {string} orgId - Organization ID
   * @param {object} orgData - Organization data to update
   * @returns {Promise<object>} Updated organization
   */
  async updateOrganization(orgId, orgData) {
    return this.request(`/orgs/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify(orgData)
    });
  }

  /**
   * Delete an organization (owner only)
   * @param {string} orgId - Organization ID
   * @returns {Promise<object>} Deletion result
   */
  async deleteOrganization(orgId) {
    return this.request(`/orgs/${orgId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Get organization members
   * @param {string} orgId - Organization ID
   * @returns {Promise<Array>} List of members with roles
   */
  async getOrgMembers(orgId) {
    return this.request(`/orgs/${orgId}/members`);
  }

  /**
   * Add a member to an organization
   * @param {string} orgId - Organization ID
   * @param {object} memberData - {user_id, role}
   * @returns {Promise<object>} Added member
   */
  async addOrgMember(orgId, memberData) {
    return this.request(`/orgs/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify(memberData)
    });
  }

  /**
   * Update organization member role
   * @param {string} orgId - Organization ID
   * @param {string} userId - User ID
   * @param {object} roleData - {role}
   * @returns {Promise<object>} Updated member
   */
  async updateOrgMemberRole(orgId, userId, roleData) {
    return this.request(`/orgs/${orgId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(roleData)
    });
  }

  /**
   * Remove a member from organization
   * @param {string} orgId - Organization ID
   * @param {string} userId - User ID to remove
   * @returns {Promise<object>} Removal result
   */
  async removeOrgMember(orgId, userId) {
    return this.request(`/orgs/${orgId}/members/${userId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Get projects within an organization
   * @param {string} orgId - Organization ID
   * @returns {Promise<Array>} List of projects
   */
  async getOrgProjects(orgId) {
    return this.request(`/orgs/${orgId}/projects`);
  }

  // ===========================
  // PROJECT MANAGEMENT APIs
  // ===========================

  /**
   * Get all projects the user has access to
   * @returns {Promise<Array>} List of projects
   */
  async getProjects() {
    return this.request('/projects');
  }

  /**
   * Get a specific project by ID
   * @param {string} projectId - Project ID
   * @returns {Promise<object>} Project details
   */
  async getProject(projectId) {
    return this.request(`/projects/${projectId}`);
  }

  /**
   * Create a new project within an organization
   * @param {string} orgId - Organization ID
   * @param {object} projectData - Project data {name, description, settings}
   * @returns {Promise<object>} Created project
   */
  async createProject(orgId, projectData) {
    return this.request(`/orgs/${orgId}/projects`, {
      method: 'POST',
      body: JSON.stringify(projectData)
    });
  }

  /**
   * Update a project
   * @param {string} projectId - Project ID
   * @param {object} projectData - Project data to update
   * @returns {Promise<object>} Updated project
   */
  async updateProject(projectId, projectData) {
    return this.request(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(projectData)
    });
  }

  /**
   * Delete a project
   * @param {string} projectId - Project ID
   * @returns {Promise<object>} Deletion result
   */
  async deleteProject(projectId) {
    return this.request(`/projects/${projectId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Get project members
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>} List of members with roles
   */
  async getProjectMembers(projectId) {
    return this.request(`/projects/${projectId}/members`);
  }

  /**
   * Add a member to a project
   * @param {string} projectId - Project ID
   * @param {object} memberData - {user_id, role}
   * @returns {Promise<object>} Added member
   */
  async addProjectMember(projectId, memberData) {
    return this.request(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify(memberData)
    });
  }

  /**
   * Remove a member from project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID to remove
   * @returns {Promise<object>} Removal result
   */
  async removeProjectMember(projectId, userId) {
    return this.request(`/projects/${projectId}/members/${userId}`, {
      method: 'DELETE'
    });
  }

  // ============================================================
  // AI API METHODS (MCP Servers, Memory, Workspace)
  // ============================================================

  /**
   * Get MCP servers from AI backend
   * @returns {Promise<object>} MCP servers result
   */
  async getMCPServers() {
    return this.request('/api/mcp-servers', {}, this.aiBaseURL);
  }

  /**
   * Save MCP server to AI backend
   * @param {string} serverName - Server name
   * @param {object} serverConfig - Server configuration
   * @returns {Promise<object>} Save result
   */
  async saveMCPServer(serverName, serverConfig) {
    return this.request('/api/mcp-servers', {
      method: 'POST',
      body: JSON.stringify({
        server_name: serverName,
        ...serverConfig
      })
    }, this.aiBaseURL);
  }

  /**
   * Delete MCP server from AI backend
   * @param {string} serverName - Server name
   * @returns {Promise<object>} Delete result
   */
  async deleteMCPServer(serverName) {
    return this.request(`/api/mcp-servers/${encodeURIComponent(serverName)}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  /**
   * Get memory (CLAUDE.md) from AI backend
   * @param {string} scope - Memory scope ('local' or 'user')
   * @returns {Promise<object>} Memory content
   */
  async getMemory(scope = 'local') {
    return this.request(`/api/memory?scope=${encodeURIComponent(scope)}`, {}, this.aiBaseURL);
  }

  /**
   * Save memory (CLAUDE.md) to AI backend
   * @param {string} content - Markdown content
   * @param {string} scope - Memory scope ('local' or 'user')
   * @returns {Promise<object>} Save result
   */
  async saveMemory(content, scope = 'local') {
    return this.request('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ content, scope })
    }, this.aiBaseURL);
  }

  /**
   * Delete memory (CLAUDE.md) from AI backend
   * @param {string} scope - Memory scope ('local' or 'user')
   * @returns {Promise<object>} Delete result
   */
  async deleteMemory(scope = 'local') {
    return this.request(`/api/memory?scope=${encodeURIComponent(scope)}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  /**
   * Sync workspace to AI backend
   * @param {string} userId - User ID
   * @returns {Promise<object>} Sync result
   */
  async syncWorkspace(userId) {
    return this.request('/api/sync-workspace', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId })
    }, this.aiBaseURL);
  }

  /**
   * Delete marketplace asynchronously
   * @param {string} marketplaceName - Marketplace name
   * @returns {Promise<object>} Delete result
   */
  async deleteMarketplace(marketplaceName) {
    return this.request(`/api/marketplace/${encodeURIComponent(marketplaceName)}`, {
      method: 'DELETE'
    }, this.aiBaseURL);
  }

  // ========================================
  // AI Agent Audit Logs
  // ========================================

  /**
   * Get audit logs for AI Agent
   * ReBAC: org_id is required for tenant isolation
   * @param {object} filters - Query filters
   * @param {string} filters.org_id - Organization ID (required)
   * @param {string} [filters.project_id] - Project ID (optional)
   * @param {string} [filters.event_category] - Filter by category (session, chat, tool, security)
   * @param {string} [filters.event_type] - Filter by specific event type
   * @param {string} [filters.status] - Filter by status (success, failure, pending)
   * @param {string} [filters.user_id] - Filter by specific user
   * @param {string} [filters.session_id] - Filter by session ID
   * @param {string} [filters.start_date] - Start date (ISO string)
   * @param {string} [filters.end_date] - End date (ISO string)
   * @param {number} [filters.limit] - Max results (default 50)
   * @param {number} [filters.offset] - Pagination offset
   * @returns {Promise<object>} { success, logs, total }
   */
  async getAuditLogs(filters = {}) {
    const params = new URLSearchParams();

    // ReBAC: org_id MANDATORY, project_id OPTIONAL
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);

    // Audit-specific filters
    if (filters.event_category) params.append('event_category', filters.event_category);
    if (filters.event_type) params.append('event_type', filters.event_type);
    if (filters.status) params.append('status', filters.status);
    if (filters.user_id) params.append('user_id', filters.user_id);
    if (filters.session_id) params.append('session_id', filters.session_id);
    if (filters.start_date) params.append('start_date', filters.start_date);
    if (filters.end_date) params.append('end_date', filters.end_date);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    const queryString = params.toString();
    return this.request(`/api/audit-logs${queryString ? `?${queryString}` : ''}`, {}, this.aiBaseURL);
  }

  /**
   * Get audit log statistics/summary
   * @param {object} filters - Query filters (same as getAuditLogs)
   * @returns {Promise<object>} { success, stats }
   */
  async getAuditStats(filters = {}) {
    const params = new URLSearchParams();
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.start_date) params.append('start_date', filters.start_date);
    if (filters.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    return this.request(`/api/audit-logs/stats${queryString ? `?${queryString}` : ''}`, {}, this.aiBaseURL);
  }

  /**
   * Export audit logs to CSV
   * @param {object} filters - Query filters
   * @returns {Promise<Blob>} CSV file blob
   */
  async exportAuditLogs(filters = {}) {
    const params = new URLSearchParams();
    if (filters.org_id) params.append('org_id', filters.org_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.event_category) params.append('event_category', filters.event_category);
    if (filters.start_date) params.append('start_date', filters.start_date);
    if (filters.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = `${this.aiBaseURL}/api/audit-logs/export${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      headers: {
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
      },
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }

    return response.blob();
  }

  // ========================================
  // Conversation Sharing
  // ========================================

  /**
   * Create a share link for a conversation
   * @param {string} conversationId - Conversation ID (UUID)
   * @param {object} options - Share options
   * @param {string} [options.title] - Custom title for the share
   * @param {string} [options.description] - Description/context
   * @param {number} [options.expires_in] - Expiry in hours (default 168 = 7 days)
   * @returns {Promise<{share: object, share_url: string}>}
   */
  async createConversationShare(conversationId, options = {}) {
    return this.request(`/conversations/${conversationId}/share`, {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Get shared conversation (public - no auth required)
   * @param {string} shareToken - Share token from URL
   * @returns {Promise<object>} Shared conversation with messages
   */
  async getSharedConversation(shareToken) {
    return this.request(`/shared/${shareToken}`, {}, this.baseURL);
  }

  /**
   * List all share links for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<{shares: object[]}>}
   */
  async listConversationShares(conversationId) {
    return this.request(`/conversations/${conversationId}/shares`);
  }

  /**
   * Revoke a share link
   * @param {string} conversationId - Conversation ID
   * @param {string} shareId - Share ID to revoke
   * @returns {Promise<{success: boolean}>}
   */
  async revokeConversationShare(conversationId, shareId) {
    return this.request(`/conversations/${conversationId}/shares/${shareId}`, {
      method: 'DELETE'
    });
  }
}

export const apiClient = new APIClient();
export default apiClient;
