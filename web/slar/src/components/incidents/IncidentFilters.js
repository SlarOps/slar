'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Select } from '../ui';

export default function IncidentFilters({ 
  filters, 
  onFiltersChange, 
  onClearFilters 
}) {
  const { user, session } = useAuth();
  const [services, setServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      if (!session?.access_token) return;
      
      try {
        setLoading(true);
        apiClient.setToken(session.access_token);
        
        // Fetch services, groups, and users for filter dropdowns
        const [servicesData, groupsData, usersData] = await Promise.all([
          apiClient.getServices().catch(err => {
            console.warn('Failed to fetch services:', err);
            return [];
          }),
          apiClient.getGroups().catch(err => {
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
  }, [session]);

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
    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* Search */}
        <div className="flex-1 min-w-64">
          <input
            type="text"
            placeholder="Search incidents..."
            value={filters.search || ''}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleAssignToMe}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              filters.assignedTo === user?.id
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Assigned to me
          </button>

          <button
            onClick={() => handleFilterChange('assignedTo', '')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              !filters.assignedTo
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            All
          </button>
        </div>

        {/* Service Filter */}
        <div className="min-w-40">
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
        <div className="min-w-40">
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
        <div className="min-w-32">
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
        <div className="min-w-40">
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

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={handleClearAll}
            className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}