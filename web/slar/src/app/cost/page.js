'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import apiClient from '@/lib/api';

export default function CostPage() {
  const { session } = useAuth();
  const { currentOrg, currentProject } = useOrg();

  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [filters, setFilters] = useState({
    model: '',
    time_range: '24h',
  });

  const [pagination, setPagination] = useState({
    limit: 50,
    offset: 0,
    total: 0,
  });

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    // Cost logs are project-scoped - require both org and project
    if (!currentOrg?.id || !currentProject?.id) return;

    setLoading(true);
    try {
      const filterParams = {
        org_id: currentOrg.id,
        project_id: currentProject.id, // Required for project-scoped cost tracking
        ...(filters.model && { model: filters.model }),
        time_range: filters.time_range,
        limit: pagination.limit,
        offset: pagination.offset,
      };

      const data = await apiClient.getCostLogs(filterParams);

      setLogs(data.logs || []);
      setPagination(prev => ({ ...prev, total: data.total || 0 }));
    } catch (error) {
      console.error('Failed to fetch cost logs:', error);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?.id, currentProject?.id, filters, pagination.limit, pagination.offset]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    // Cost stats are project-scoped - require both org and project
    if (!currentOrg?.id || !currentProject?.id) return;

    try {
      const statsParams = {
        org_id: currentOrg.id,
        project_id: currentProject.id, // Required for project-scoped cost tracking
        time_range: filters.time_range,
      };

      const data = await apiClient.getCostStats(statsParams);
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, [currentOrg?.id, currentProject?.id, filters.time_range]);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [fetchLogs, fetchStats]);

  // Export handler
  const handleExport = async () => {
    if (!currentProject?.id) return;

    setExporting(true);
    try {
      const blob = await apiClient.exportCostLogs({
        org_id: currentOrg.id,
        project_id: currentProject.id, // Required for project-scoped cost tracking
        ...filters,
      });

      // Download file
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cost-logs-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export cost logs');
    } finally {
      setExporting(false);
    }
  };

  // Format currency
  const formatCost = (cost) => {
    return `$${Number(cost).toFixed(6)}`;
  };

  // Format number with commas
  const formatNumber = (num) => {
    return Number(num).toLocaleString();
  };

  // Format date
  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  // Show project selection prompt if no project selected
  if (!currentProject?.id) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold text-yellow-800 mb-2">
            Project Required
          </h2>
          <p className="text-yellow-700">
            AI cost tracking is project-scoped. Please select a project from the sidebar to view cost data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Cost Tracking</h1>
          <p className="text-sm text-gray-600 mt-1">
            Project: {currentProject.name}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Stats Cards */}
      {stats?.stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Total Cost</div>
            <div className="text-2xl font-bold text-blue-600">
              {formatCost(stats.stats.total_cost)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {formatNumber(stats.stats.total_requests)} requests
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Avg Cost/Request</div>
            <div className="text-2xl font-bold text-green-600">
              {formatCost(stats.stats.avg_cost_per_request)}
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Input Tokens</div>
            <div className="text-2xl font-bold text-purple-600">
              {formatNumber(stats.stats.total_input_tokens)}
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Output Tokens</div>
            <div className="text-2xl font-bold text-orange-600">
              {formatNumber(stats.stats.total_output_tokens)}
            </div>
          </div>
        </div>
      )}

      {/* Cost by Model & User */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cost by Model */}
        {stats?.by_model && stats.by_model.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-3">Cost by Model</h2>
            <div className="space-y-2">
              {stats.by_model.map((model) => (
                <div key={model.model} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{model.model}</div>
                    <div className="text-sm text-gray-600">
                      {formatNumber(model.requests)} requests
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-blue-600">
                      {formatCost(model.total_cost)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatNumber(model.input_tokens)} in / {formatNumber(model.output_tokens)} out
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost by User */}
        {stats?.by_user && stats.by_user.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-3">Cost by User</h2>
            <div className="space-y-2">
              {stats.by_user.map((user) => (
                <div key={user.user_id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm truncate" title={user.user_id}>
                      {user.user_id?.substring(0, 8)}...
                    </div>
                    <div className="text-sm text-gray-600">
                      {formatNumber(user.requests)} requests
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-purple-600">
                      {formatCost(user.total_cost)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatNumber(user.input_tokens)} in / {formatNumber(user.output_tokens)} out
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex gap-3">
          <select
            value={filters.model}
            onChange={(e) => {
              setFilters({ ...filters, model: e.target.value });
              setPagination({ ...pagination, offset: 0 });
            }}
            className="border rounded px-3 py-2"
          >
            <option value="">All Models</option>
            <option value="claude-opus-4.6">Claude Opus</option>
            <option value="claude-sonnet-4.5">Claude Sonnet</option>
            <option value="claude-haiku-4.5">Claude Haiku</option>
          </select>

          <select
            value={filters.time_range}
            onChange={(e) => {
              setFilters({ ...filters, time_range: e.target.value });
              setPagination({ ...pagination, offset: 0 });
            }}
            className="border rounded px-3 py-2"
          >
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Model
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Input
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Output
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Total
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Cost
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan="7" className="px-6 py-4 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-4 text-center text-gray-500">
                  No cost data found
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.event_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    <div className="truncate max-w-[120px]" title={log.user_id}>
                      {log.user_id?.substring(0, 8)}...
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {log.model}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatNumber(log.input_tokens)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatNumber(log.output_tokens)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatNumber(log.total_tokens)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 text-right">
                    {formatCost(log.total_cost_usd)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.total > 0 && (
        <div className="flex items-center justify-between bg-white px-4 py-3 rounded-lg shadow">
          <div className="text-sm text-gray-700">
            Showing {pagination.offset + 1} to {Math.min(pagination.offset + pagination.limit, pagination.total)} of{' '}
            {pagination.total} results
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPagination({ ...pagination, offset: Math.max(0, pagination.offset - pagination.limit) })}
              disabled={pagination.offset === 0}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPagination({ ...pagination, offset: pagination.offset + pagination.limit })}
              disabled={pagination.offset + pagination.limit >= pagination.total}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
