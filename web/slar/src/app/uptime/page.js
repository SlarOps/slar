'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import UptimeFilters from '../../components/uptime/UptimeFilters';
import ServicesList from '../../components/uptime/ServicesList';

const INITIAL_FILTERS = {
  search: '',
  type: '',
  status: '',
  sort: 'created_at_desc'
};

export default function UptimePage() {
  const router = useRouter();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [stats, setStats] = useState({
    total: 0,
    up: 0,
    down: 0,
    timeout: 0,
    error: 0,
    average_uptime: 0,
    average_response_time: 0
  });

  // Simulate fetching uptime stats
  useEffect(() => {
    const fetchStats = async () => {
      // TODO: Replace with actual API call
      // const data = await apiClient.getUptimeStats();
      setTimeout(() => {
        setStats({
          total: 4,
          up: 2,
          down: 1,
          timeout: 1,
          error: 0,
          average_uptime: 98.2,
          average_response_time: 245
        });
      }, 500);
    };

    fetchStats();
  }, []);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleAddService = () => {
    router.push('/uptime/add');
  };

  const handleEditService = (serviceId) => {
    router.push(`/uptime/${serviceId}/edit`);
  };

  const handleServiceAction = (action, serviceId) => {
    console.log(`Service ${action}:`, serviceId);
    // TODO: Show toast notification
    // TODO: Refresh stats if needed
  };

  const getStatusPercentage = (count) => {
    return stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : 0;
  };

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Uptime Monitoring</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Monitor your services and endpoints for availability and performance
        </p>
        
        {/* Overview Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Services</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-800 p-3">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.up}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Up ({getStatusPercentage(stats.up)}%)</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-800 p-3">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.down}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Down ({getStatusPercentage(stats.down)}%)</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-yellow-200 dark:border-yellow-800 p-3">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.timeout}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Timeout ({getStatusPercentage(stats.timeout)}%)</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">{stats.error}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Error ({getStatusPercentage(stats.error)}%)</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-800 p-3">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.average_uptime}%</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Avg Uptime</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-purple-200 dark:border-purple-800 p-3">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.average_response_time}ms</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Avg Response</div>
          </div>
        </div>

        {/* Status Overview Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Overall Status</h3>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {stats.up}/{stats.total} services operational
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className="bg-green-500 h-2 rounded-full transition-all duration-300" 
              style={{ width: `${getStatusPercentage(stats.up)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <UptimeFilters 
        filters={filters}
        onFiltersChange={handleFiltersChange}
        totalCount={stats.total}
        onAddService={handleAddService}
      />

      {/* Services List */}
      <ServicesList 
        filters={filters}
        onServiceAction={handleServiceAction}
        onAddService={handleAddService}
        onEditService={handleEditService}
      />
    </div>
  );
}


