'use client';

import { useState, useEffect } from 'react';

// Common alert labels for grouping
const COMMON_LABEL_GROUPS = [
  {
    key: 'environment',
    label: 'Environment',
    values: ['production', 'staging', 'development', 'test']
  },
  {
    key: 'service',
    label: 'Service',
    values: ['web', 'api', 'database', 'redis', 'nginx', 'queue']
  },
  {
    key: 'team',
    label: 'Team',
    values: ['platform', 'backend', 'frontend', 'devops', 'sre']
  },
  {
    key: 'cluster',
    label: 'Cluster',
    values: ['production', 'staging', 'monitoring']
  },
  {
    key: 'severity',
    label: 'Severity',
    values: ['critical', 'high', 'medium', 'low', 'info']
  }
];

// Mock data for available label values
const MOCK_ALERT_LABELS = {
  environment: ['production', 'staging', 'development'],
  service: ['web', 'api', 'database', 'redis'],
  team: ['platform', 'backend', 'frontend'],
  cluster: ['production', 'staging'],
  alertname: ['HighCPUUsage', 'HighMemoryUsage', 'DiskSpaceLow', 'ServiceDown'],
  instance: ['web-01', 'web-02', 'db-01', 'redis-01'],
  job: ['web-server', 'api-server', 'database', 'monitoring']
};

export default function AlertGroupFilters({ 
  filters, 
  onFiltersChange, 
  totalCount, 
  showDefaultSettings = true 
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDefaultModal, setShowDefaultModal] = useState(false);
  const [availableLabels, setAvailableLabels] = useState(MOCK_ALERT_LABELS);
  const [defaultFilters, setDefaultFilters] = useState(null);

  useEffect(() => {
    // Load user's default filters from localStorage
    const saved = localStorage.getItem('alertDefaultFilters');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setDefaultFilters(parsed);
        
        // Apply default filters on first load if no current filters
        if (!filters.labels && !filters.search && !filters.severity) {
          onFiltersChange({ ...filters, ...parsed });
        }
      } catch (error) {
        console.error('Failed to parse saved default filters:', error);
      }
    }
  }, []);

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    onFiltersChange(newFilters);
  };

  const handleLabelFilterChange = (labelKey, value) => {
    const currentLabels = filters.labels || {};
    const newLabels = { ...currentLabels };
    
    if (value) {
      newLabels[labelKey] = value;
    } else {
      delete newLabels[labelKey];
    }
    
    handleFilterChange('labels', Object.keys(newLabels).length > 0 ? newLabels : undefined);
  };

  const handleClearFilters = () => {
    onFiltersChange({
      search: '',
      severity: '',
      status: '',
      labels: undefined,
      sort: filters.sort || 'created_at_desc'
    });
  };

  const handleSaveAsDefault = () => {
    const filtersToSave = {
      severity: filters.severity,
      status: filters.status,
      labels: filters.labels
    };
    
    localStorage.setItem('alertDefaultFilters', JSON.stringify(filtersToSave));
    setDefaultFilters(filtersToSave);
    setShowDefaultModal(false);
  };

  const handleClearDefault = () => {
    localStorage.removeItem('alertDefaultFilters');
    setDefaultFilters(null);
    setShowDefaultModal(false);
  };

  const getActiveLabelCount = () => {
    return filters.labels ? Object.keys(filters.labels).length : 0;
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.search) count++;
    if (filters.severity) count++;
    if (filters.status) count++;
    if (filters.labels) count += Object.keys(filters.labels).length;
    return count;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Filters {totalCount > 0 && `(${totalCount} alerts)`}
          </h3>
          {getActiveFilterCount() > 0 && (
            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              {getActiveFilterCount()} active
            </span>
          )}
          {defaultFilters && (
            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
              Default applied
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {showDefaultSettings && (
            <button
              onClick={() => setShowDefaultModal(true)}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:underline"
            >
              Set Default
            </button>
          )}
          {getActiveFilterCount() > 0 && (
            <button
              onClick={handleClearFilters}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:underline"
            >
              Clear All
            </button>
          )}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showAdvanced ? 'Simple' : 'Advanced'}
          </button>
        </div>
      </div>

      {/* Basic Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {/* Search */}
        <div>
          <input
            type="text"
            placeholder="Search alerts..."
            value={filters.search || ''}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Severity */}
        <div>
          <select
            value={filters.severity || ''}
            onChange={(e) => handleFilterChange('severity', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
        </div>

        {/* Status */}
        <div>
          <select
            value={filters.status || ''}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Statuses</option>
            <option value="firing">Firing</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        {/* Sort */}
        <div>
          <select
            value={filters.sort || 'created_at_desc'}
            onChange={(e) => handleFilterChange('sort', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="created_at_desc">Newest First</option>
            <option value="created_at_asc">Oldest First</option>
            <option value="severity_desc">Severity (High to Low)</option>
            <option value="severity_asc">Severity (Low to High)</option>
            <option value="title_asc">Title A-Z</option>
            <option value="title_desc">Title Z-A</option>
          </select>
        </div>
      </div>

      {/* Advanced Label Filters */}
      {showAdvanced && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Label Filters
            {getActiveLabelCount() > 0 && (
              <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                ({getActiveLabelCount()} active)
              </span>
            )}
          </h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {COMMON_LABEL_GROUPS.map((group) => (
              <div key={group.key}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {group.label}
                </label>
                <select
                  value={filters.labels?.[group.key] || ''}
                  onChange={(e) => handleLabelFilterChange(group.key, e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All {group.label}s</option>
                  {(availableLabels[group.key] || group.values).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Active Label Filters Display */}
          {filters.labels && Object.keys(filters.labels).length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Active label filters:</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(filters.labels).map(([key, value]) => (
                  <span
                    key={`${key}:${value}`}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded"
                  >
                    {key}={value}
                    <button
                      onClick={() => handleLabelFilterChange(key, '')}
                      className="text-blue-400 hover:text-blue-600 ml-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Default Filters Modal */}
      {showDefaultModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Default Filters</h3>
                <button
                  onClick={() => setShowDefaultModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Set your preferred default filters. These will be automatically applied when you open the alerts page.
                </p>

                {defaultFilters && (
                  <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Current defaults:</div>
                    <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                      {defaultFilters.severity && <div>Severity: {defaultFilters.severity}</div>}
                      {defaultFilters.status && <div>Status: {defaultFilters.status}</div>}
                      {defaultFilters.labels && Object.entries(defaultFilters.labels).map(([key, value]) => (
                        <div key={key}>{key}: {value}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  {defaultFilters && (
                    <button
                      onClick={handleClearDefault}
                      className="px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    >
                      Clear Default
                    </button>
                  )}
                  <button
                    onClick={() => setShowDefaultModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAsDefault}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Save as Default
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
