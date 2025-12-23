'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';

// Event category colors and labels
const CATEGORY_CONFIG = {
  session: { color: 'blue', label: 'Session', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  chat: { color: 'green', label: 'Chat', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
  tool: { color: 'purple', label: 'Tool', bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  security: { color: 'red', label: 'Security', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
};

// Status colors
const STATUS_CONFIG = {
  success: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  failure: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500' },
};

const INITIAL_FILTERS = {
  event_category: '',
  status: '',
  time_range: '24h',
};

export default function AuditPage() {
  const { session } = useAuth();
  const { currentOrg, currentProject, loading: orgLoading } = useOrg();

  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [pagination, setPagination] = useState({ limit: 50, offset: 0, total: 0 });
  const [selectedLog, setSelectedLog] = useState(null);

  // Calculate date range from time_range filter
  const getDateRange = useCallback(() => {
    const now = new Date();
    const ranges = {
      '1h': 1 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const range = ranges[filters.time_range] || ranges['24h'];
    return {
      start_date: new Date(now.getTime() - range).toISOString(),
      end_date: now.toISOString(),
    };
  }, [filters.time_range]);

  // Fetch audit logs
  const fetchLogs = useCallback(async () => {
    if (!session?.access_token || !currentOrg?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      apiClient.setToken(session.access_token);

      const dateRange = getDateRange();
      const filterParams = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id }),
        ...(filters.event_category && { event_category: filters.event_category }),
        ...(filters.status && { status: filters.status }),
        start_date: dateRange.start_date,
        end_date: dateRange.end_date,
        limit: pagination.limit,
        offset: pagination.offset,
      };

      const data = await apiClient.getAuditLogs(filterParams);

      if (data.success) {
        setLogs(data.logs || []);
        setPagination(prev => ({ ...prev, total: data.total || 0 }));
      } else {
        setError(data.error || 'Failed to fetch audit logs');
      }
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [session, currentOrg?.id, currentProject?.id, filters, pagination.limit, pagination.offset, getDateRange]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    if (!session?.access_token || !currentOrg?.id) return;

    try {
      apiClient.setToken(session.access_token);
      const dateRange = getDateRange();

      const data = await apiClient.getAuditStats({
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id }),
        start_date: dateRange.start_date,
        end_date: dateRange.end_date,
      });

      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Error fetching audit stats:', err);
    }
  }, [session, currentOrg?.id, currentProject?.id, getDateRange]);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [fetchLogs, fetchStats]);

  // Handle export
  const handleExport = async () => {
    try {
      apiClient.setToken(session.access_token);
      const dateRange = getDateRange();

      const blob = await apiClient.exportAuditLogs({
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id }),
        ...(filters.event_category && { event_category: filters.event_category }),
        start_date: dateRange.start_date,
        end_date: dateRange.end_date,
      });

      // Download file
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export audit logs');
    }
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Format relative time
  const formatRelativeTime = (timestamp) => {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Show loading state while org is being loaded
  if (orgLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading organization...</p>
        </div>
      </div>
    );
  }

  // Show message if no organization is selected
  if (!currentOrg?.id) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Organization Selected</h3>
          <p className="text-gray-600 dark:text-gray-400">Please select an organization to view audit logs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">AI Agent Audit Logs</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Monitor AI agent activities, tool executions, and security events
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex">
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="ml-3">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              {stats.total_events || 0}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Total Events</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-purple-200 dark:border-purple-800 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-purple-600 dark:text-purple-400">
              {stats.tool_executions || 0}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Tool Executions</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-800 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-red-600 dark:text-red-400">
              {stats.security_events || 0}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Security Events</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-800 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.success_rate ? `${stats.success_rate}%` : 'N/A'}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Success Rate</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
          <select
            value={filters.event_category}
            onChange={(e) => setFilters({ ...filters, event_category: e.target.value })}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
          >
            <option value="">All Categories</option>
            <option value="session">Session</option>
            <option value="chat">Chat</option>
            <option value="tool">Tool</option>
            <option value="security">Security</option>
          </select>
        </div>

        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
          >
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Time Range</label>
          <select
            value={filters.time_range}
            onChange={(e) => setFilters({ ...filters, time_range: e.target.value })}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
          >
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={() => setFilters(INITIAL_FILTERS)}
            className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Event
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  User
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <span className="text-gray-600 dark:text-gray-400">Loading audit logs...</span>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <div className="text-gray-500 dark:text-gray-400">
                      <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <p>No audit logs found</p>
                      <p className="text-sm mt-1">Try adjusting your filters or time range</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const category = CATEGORY_CONFIG[log.event_category] || CATEGORY_CONFIG.session;
                  const status = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;

                  return (
                    <tr
                      key={log.event_id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-900/50 cursor-pointer"
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{formatRelativeTime(log.event_time)}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{formatTime(log.event_time)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${category.bg} ${category.text}`}>
                          {category.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900 dark:text-white">{log.event_type}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
                          {log.action}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {log.user_email || log.user_id?.substring(0, 8) + '...'}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.total > pagination.limit && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Showing {pagination.offset + 1} to {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                disabled={pagination.offset === 0}
                className="px-3 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                disabled={pagination.offset + pagination.limit >= pagination.total}
                className="px-3 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75" onClick={() => setSelectedLog(null)} />

            <div className="relative z-50 w-full max-w-2xl p-6 bg-white dark:bg-gray-800 rounded-xl shadow-xl">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Audit Log Details
                </h3>
                <button onClick={() => setSelectedLog(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4 text-left">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Event ID</label>
                    <p className="text-sm text-gray-900 dark:text-white font-mono">{selectedLog.event_id}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Time</label>
                    <p className="text-sm text-gray-900 dark:text-white">{formatTime(selectedLog.event_time)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Category</label>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${CATEGORY_CONFIG[selectedLog.event_category]?.bg} ${CATEGORY_CONFIG[selectedLog.event_category]?.text}`}>
                      {CATEGORY_CONFIG[selectedLog.event_category]?.label || selectedLog.event_category}
                    </span>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${STATUS_CONFIG[selectedLog.status]?.bg} ${STATUS_CONFIG[selectedLog.status]?.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[selectedLog.status]?.dot}`}></span>
                      {selectedLog.status}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Event Type</label>
                  <p className="text-sm text-gray-900 dark:text-white">{selectedLog.event_type}</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Action</label>
                  <p className="text-sm text-gray-900 dark:text-white">{selectedLog.action}</p>
                </div>

                {selectedLog.user_email && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">User</label>
                    <p className="text-sm text-gray-900 dark:text-white">{selectedLog.user_email}</p>
                  </div>
                )}

                {selectedLog.session_id && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Session ID</label>
                    <p className="text-sm text-gray-900 dark:text-white font-mono text-xs">{selectedLog.session_id}</p>
                  </div>
                )}

                {selectedLog.source_ip && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Source IP</label>
                    <p className="text-sm text-gray-900 dark:text-white font-mono">{selectedLog.source_ip}</p>
                  </div>
                )}

                {selectedLog.error_message && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Error</label>
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                      <p className="text-sm text-red-700 dark:text-red-300">{selectedLog.error_message}</p>
                      {selectedLog.error_code && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Code: {selectedLog.error_code}</p>
                      )}
                    </div>
                  </div>
                )}

                {selectedLog.duration_ms && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Duration</label>
                    <p className="text-sm text-gray-900 dark:text-white">{selectedLog.duration_ms}ms</p>
                  </div>
                )}

                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Metadata</label>
                    <pre className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.request_params && Object.keys(selectedLog.request_params).length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Request Parameters</label>
                    <pre className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs overflow-x-auto max-h-40">
                      {JSON.stringify(selectedLog.request_params, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
