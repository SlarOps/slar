'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';
import { Select } from '../ui';

export default function IncidentFilters({
  filters,
  onFiltersChange,
  onClearFilters
}) {
  const { user, session } = useAuth();
  const { currentOrg, currentProject } = useOrg();
  const [services, setServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      if (!session?.access_token || !currentOrg?.id) return;

      try {
        setLoading(true);
        apiClient.setToken(session.access_token);

        // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
        const rebacFilters = {
          org_id: currentOrg.id,
          ...(currentProject?.id && { project_id: currentProject.id })
        };

        // Fetch services, groups, and users for filter dropdowns
        const [servicesData, groupsData, usersData] = await Promise.all([
          apiClient.getServices(rebacFilters).catch(err => {
            console.warn('Failed to fetch services:', err);
            return [];
          }),
          apiClient.getGroups(rebacFilters).catch(err => {
            console.warn('Failed to fetch groups:', err);
            return [];
          }),
          apiClient.getUsers().catch(err => {
            console.warn('Failed to fetch users:', err);
            return [];
          })
        ]);

        // Ensure we always have arrays
        setServices(Array.isArray(servicesData) ? servicesData : []);
        setGroups(Array.isArray(groupsData) ? groupsData : []);
        setUsers(Array.isArray(usersData) ? usersData : []);
      } catch (err) {
        console.error('Error fetching filter options:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFilterOptions();
  }, [session, currentOrg?.id, currentProject?.id]);

  const handleFilterChange = (key, value) => {
    onFiltersChange({
      ...filters,
      [key]: value
    });
  };

  const handleAssignToMe = () => {
    onFiltersChange({
      ...filters,
      assignedTo: user?.id || ''
    });
  };

  const handleClearAll = () => {
    onClearFilters();
  };

  const hasActiveFilters = Object.values(filters).some(value => 
    value && value !== '' && value !== 'created_at_desc'
  );

  return (
    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 md:p-4">
      <div className="space-y-3">
        {/* Search and Toggle Row */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search incidents..."
              value={filters.search || ''}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Toggle Advanced Filters (Mobile) */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="md:hidden flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Filters
            {hasActiveFilters && (
              <span className="bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {Object.values(filters).filter(v => v && v !== '' && v !== 'created_at_desc').length}
              </span>
            )}
          </button>
        </div>

        {/* Filters Container */}
        <div className={`${showAdvanced ? 'block' : 'hidden md:block'} space-y-3`}>
          {/* Quick Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleAssignToMe}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                filters.assignedTo === user?.id
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Assigned to me
            </button>

            <button
              onClick={() => handleFilterChange('assignedTo', '')}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                !filters.assignedTo
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              All
            </button>

            {/* Clear Filters (Mobile) */}
            {hasActiveFilters && (
              <button
                onClick={handleClearAll}
                className="md:hidden px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Dropdown Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {/* Service Filter */}
            <div>
              <Select
                value={filters.service || ''}
                onChange={(value) => handleFilterChange('service', value)}
                placeholder="Service"
                options={[
                  { value: '', label: 'All Services' },
                  ...(Array.isArray(services) ? services.map(service => ({
                    value: service.id,
                    label: service.name
                  })) : [])
                ]}
                disabled={loading}
              />
            </div>

            {/* Group Filter */}
            <div>
              <Select
                value={filters.group || ''}
                onChange={(value) => handleFilterChange('group', value)}
                placeholder="Group"
                options={[
                  { value: '', label: 'All Groups' },
                  ...(Array.isArray(groups) ? groups.map(group => ({
                    value: group.id,
                    label: group.name
                  })) : [])
                ]}
                disabled={loading}
              />
            </div>

            {/* Urgency Filter */}
            <div>
              <Select
                value={filters.urgency || ''}
                onChange={(value) => handleFilterChange('urgency', value)}
                placeholder="Urgency"
                options={[
                  { value: '', label: 'All' },
                  { value: 'high', label: 'High' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'low', label: 'Low' }
                ]}
              />
            </div>

            {/* Time Range Filter */}
            <div>
              <Select
                value={filters.timeRange || 'last_30_days'}
                onChange={(value) => handleFilterChange('timeRange', value)}
                placeholder="Time Range"
                options={[
                  { value: 'last_24_hours', label: 'Last 24 hours' },
                  { value: 'last_7_days', label: 'Last 7 days' },
                  { value: 'last_30_days', label: 'Last 30 days' },
                  { value: 'last_90_days', label: 'Last 90 days' },
                  { value: 'all', label: 'All time' }
                ]}
              />
            </div>

            {/* Clear Filters (Desktop) */}
            {hasActiveFilters && (
              <div className="hidden md:flex items-center">
                <button
                  onClick={handleClearAll}
                  className="w-full px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}