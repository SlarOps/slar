'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { apiClient } from '../../lib/api';
import UptimeStatusBar from '../../components/monitors/UptimeStatusBar';
import ResponseTimeChart from '../../components/monitors/ResponseTimeChart';
import MonitorModal from '../../components/monitors/MonitorModal';
import DeploymentModal from '../../components/monitors/DeploymentModal';
import DeleteDeploymentModal from '../../components/monitors/DeleteDeploymentModal';
import WorkerDetailsModal from '../../components/monitors/WorkerDetailsModal';

export default function MonitorsPage() {
    const { user, session } = useAuth();
    const [monitors, setMonitors] = useState([]);
    const [deployments, setDeployments] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal States
    const [showDeployModal, setShowDeployModal] = useState(false);
    const [showMonitorModal, setShowMonitorModal] = useState(false);
    const [showWorkerModal, setShowWorkerModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    // Selection States
    const [selectedDeployment, setSelectedDeployment] = useState(null);
    const [workerModalDeployment, setWorkerModalDeployment] = useState(null);
    const [deploymentToDelete, setDeploymentToDelete] = useState(null);
    const [monitorToEdit, setMonitorToEdit] = useState(null);
    const [columnCount, setColumnCount] = useState(2);

    useEffect(() => {
        if (session?.access_token) {
            apiClient.setToken(session.access_token);
            loadData();
        }
    }, [session]);

    // Auto-select first deployment if only one exists
    useEffect(() => {
        if (deployments.length === 1 && !selectedDeployment) {
            setSelectedDeployment(deployments[0]);
        }
    }, [deployments, selectedDeployment]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Fetch deployments first
            const deploymentsData = await apiClient.getMonitorDeployments();
            setDeployments(Array.isArray(deploymentsData) ? deploymentsData : []);

            // Fetch monitors filtered by selected deployment if exists
            const monitorsData = selectedDeployment
                ? await apiClient.getMonitors(selectedDeployment.id)
                : await apiClient.getMonitors();
            setMonitors(Array.isArray(monitorsData) ? monitorsData : []);
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error('Failed to load monitors');
        } finally {
            setLoading(false);
        }
    };

    const handleWorkerClick = (deployment) => {
        setSelectedDeployment(deployment);
        setWorkerModalDeployment(deployment);
        setShowWorkerModal(true);
    };

    const handleDeleteClick = (deployment) => {
        setDeploymentToDelete(deployment);
        setShowDeleteModal(true);
    };

    const handleWorkerModalDelete = () => {
        setShowWorkerModal(false);
        setDeploymentToDelete(workerModalDeployment);
        setShowDeleteModal(true);
    };

    const handleEditMonitor = (monitor) => {
        setMonitorToEdit(monitor);
        setShowMonitorModal(true);
    };

    const handleCloseMonitorModal = () => {
        setShowMonitorModal(false);
        setMonitorToEdit(null);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Uptime Monitors</h1>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                        Cloudflare Worker-based monitoring
                    </p>
                </div>
                <button
                    onClick={() => setShowDeployModal(true)}
                    className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
                >
                    {deployments.length === 0 ? 'Deploy Worker' : 'Deploy Another'}
                </button>
            </div>

            {/* Deployments Section */}
            <div className="mb-4 sm:mb-6">
                <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Worker Deployments</h2>
                    {deployments.length > 0 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {deployments.length} deployment{deployments.length > 1 ? 's' : ''}
                        </p>
                    )}
                </div>
                {deployments.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
                        <div className="text-gray-400 dark:text-gray-500 mb-2">
                            <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">No worker deployments yet</p>
                        <button
                            onClick={() => setShowDeployModal(true)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                        >
                            Deploy Your First Worker
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-2 sm:gap-3">
                        {deployments.map((deployment) => (
                            <DeploymentCard
                                key={deployment.id}
                                deployment={deployment}
                                onSelect={() => handleWorkerClick(deployment)}
                                onDelete={() => handleDeleteClick(deployment)}
                                onUpdate={loadData}
                                isSelected={selectedDeployment?.id === deployment.id}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Monitors Section */}
            {selectedDeployment && (
                <div className="mb-4 sm:mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 sm:mb-3">
                        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                            Monitors for {selectedDeployment.name}
                        </h2>
                        <div className="flex items-center gap-2">
                            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                <button
                                    onClick={() => setColumnCount(1)}
                                    className={`p-1.5 rounded-md transition-all ${columnCount === 1
                                        ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                        }`}
                                    title="Single Column"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => setColumnCount(2)}
                                    className={`p-1.5 rounded-md transition-all ${columnCount === 2
                                        ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                        }`}
                                    title="Two Columns"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v16M15 4v16M4 4h16M4 20h16" />
                                    </svg>
                                </button>
                            </div>
                            <button
                                onClick={() => setShowMonitorModal(true)}
                                className="w-full sm:w-auto px-3 sm:px-4 py-1.5 sm:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium shadow-sm"
                            >
                                Add Monitor
                            </button>
                        </div>
                    </div >
                    <div className={`grid gap-2 sm:gap-3 ${columnCount === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                        {monitors
                            .filter(m => m.deployment_id === selectedDeployment.id)
                            .map((monitor) => (
                                <MonitorCard
                                    key={monitor.id}
                                    monitor={monitor}
                                    onUpdate={loadData}
                                    onEdit={() => handleEditMonitor(monitor)}
                                    workerUrl={selectedDeployment.worker_url}
                                />
                            ))}
                    </div>
                </div >
            )
            }

            {/* Modals */}
            {
                showDeployModal && (
                    <DeploymentModal onClose={() => setShowDeployModal(false)} onSuccess={loadData} />
                )
            }
            {
                showMonitorModal && selectedDeployment && (
                    <MonitorModal
                        deploymentId={selectedDeployment.id}
                        monitor={monitorToEdit}
                        onClose={handleCloseMonitorModal}
                        onSuccess={loadData}
                    />
                )
            }
            {
                showWorkerModal && workerModalDeployment && (
                    <WorkerDetailsModal
                        deployment={workerModalDeployment}
                        onClose={() => setShowWorkerModal(false)}
                        onUpdate={loadData}
                        onDeleteClick={handleWorkerModalDelete}
                    />
                )
            }
            {
                showDeleteModal && deploymentToDelete && (
                    <DeleteDeploymentModal
                        deployment={deploymentToDelete}
                        onClose={() => setShowDeleteModal(false)}
                        onSuccess={() => {
                            loadData();
                            if (selectedDeployment?.id === deploymentToDelete.id) {
                                setSelectedDeployment(null);
                            }
                        }}
                    />
                )
            }
        </div >
    );
}

function DeploymentCard({ deployment, onSelect, onUpdate, onDelete, isSelected }) {
    const [redeploying, setRedeploying] = useState(false);
    const [stats, setStats] = useState(null);
    const [loadingStats, setLoadingStats] = useState(true);

    useEffect(() => {
        loadStats();
    }, [deployment.id]);

    const loadStats = async () => {
        try {
            setLoadingStats(true);
            const data = await apiClient.getDeploymentStats(deployment.id);
            setStats(data);
        } catch (error) {
            console.error('Failed to load deployment stats:', error);
        } finally {
            setLoadingStats(false);
        }
    };

    const handleRedeploy = async (e) => {
        e.stopPropagation();
        if (!confirm('Redeploy this worker with latest code?')) return;

        try {
            setRedeploying(true);
            await apiClient.redeployMonitorWorker(deployment.id);
            toast.success('Worker redeployed successfully');
            onUpdate();
        } catch (error) {
            console.error('Failed to redeploy:', error);
            toast.error('Failed to redeploy worker');
        } finally {
            setRedeploying(false);
        }
    };

    const handleDelete = (e) => {
        e.stopPropagation();
        onDelete();
    };

    return (
        <div
            className={`bg-white dark:bg-gray-800 rounded-lg border p-3 sm:p-4 transition-colors cursor-pointer ${isSelected
                ? 'border-blue-500 dark:border-blue-500 ring-1 ring-blue-500'
                : 'border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500'
                }`}
            onClick={onSelect}
        >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1">{deployment.name}</h3>
                    <div className="space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                        <p className="truncate">Worker: <span className="font-mono text-blue-600 dark:text-blue-400">{deployment.worker_name}</span></p>
                        <p className="text-xs">Deployed: {new Date(deployment.last_deployed_at).toLocaleDateString()}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <button
                        onClick={handleRedeploy}
                        disabled={redeploying}
                        className="px-2 sm:px-3 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
                    >
                        {redeploying ? 'Redeploying...' : 'Redeploy'}
                    </button>
                    <button
                        onClick={handleDelete}
                        className="px-2 sm:px-3 py-1 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/40 transition-colors"
                    >
                        Delete
                    </button>
                    <span className="px-2 sm:px-3 py-1 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full text-xs font-medium">
                        Active
                    </span>
                </div>
            </div>

            {/* Worker Stats */}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
                {loadingStats ? (
                    <div className="flex gap-4 animate-pulse">
                        <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                        <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                        <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    </div>
                ) : stats ? (
                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                        <div className="flex items-center gap-1" title="Requests (24h)">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                            <span>{stats.metrics?.requests?.toLocaleString() || 0} requests</span>
                        </div>
                        <div className="flex items-center gap-1" title="Errors (24h)">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span>{stats.metrics?.errors?.toLocaleString() || 0} errors</span>
                        </div>
                        <div className="flex items-center gap-1" title="Avg CPU Time">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                            <span>{stats.metrics?.cpu_time?.toFixed(2) || 0} ms</span>
                        </div>
                        <div className="flex items-center gap-1" title="Bindings">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                            </svg>
                            <span>{stats.details?.bindings?.length || 0} bindings</span>
                        </div>
                    </div>
                ) : (
                    <div className="text-xs text-gray-400">Stats unavailable</div>
                )}
            </div>
        </div >
    );
}

function MonitorCard({ monitor, onUpdate, onEdit, workerUrl }) {
    const [stats, setStats] = useState(null);
    const [responseTimes, setResponseTimes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const [cacheStatus, setCacheStatus] = useState(null);

    useEffect(() => {
        loadMonitorStats();
    }, [monitor.id, workerUrl]);

    const loadMonitorStats = async () => {
        try {
            setLoading(true);
            
            // ✅ Use Worker API if available (fast, CDN cached)
            if (workerUrl) {
                try {
                    const data = await apiClient.getWorkerMonitorStats(workerUrl, monitor.id);
                    setStats({
                        uptime_percent: data.stats?.uptime_percent || 0,
                        avg_latency_ms: data.stats?.avg_latency_ms || 0,
                        total_checks: data.stats?.total_checks || 0
                    });
                    // Convert recent_logs to response times format (chart expects 'time' property)
                    setResponseTimes((data.recent_logs || []).map(log => ({
                        time: new Date(log.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        timestamp: log.timestamp,
                        latency: log.latency,
                        is_up: log.is_up,
                        status: log.status,
                        error: log.error
                    })).reverse()); // Reverse to show oldest first (left to right)
                    setCacheStatus(data._cache_status);
                    return;
                } catch (workerError) {
                    console.warn('Worker API failed, falling back to Go API:', workerError);
                }
            }
            
            // ❌ Fallback to Go API (slow, but works without worker URL)
            const [statsData, responseData] = await Promise.all([
                apiClient.getMonitorStats(monitor.id),
                apiClient.getMonitorResponseTimes(monitor.id, '24h')
            ]);
            setStats(statsData);
            setResponseTimes(responseData);
            setCacheStatus(null);
        } catch (error) {
            console.error('Failed to load monitor stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        await loadMonitorStats();
    };



    const handleDelete = async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this monitor?')) return;
        try {
            await apiClient.deleteMonitor(monitor.id);
            toast.success('Monitor deleted');
            onUpdate();
        } catch (error) {
            console.error('Failed to delete monitor:', error);
            toast.error('Failed to delete monitor');
        }
    };

    const handleEdit = (e) => {
        e.stopPropagation();
        onEdit();
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Collapsed View - Always Visible */}
            <div
                className="p-3 sm:p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                            {/* Expand/Collapse Icon */}
                            <svg
                                className={`w-3 h-3 sm:w-4 sm:h-4 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>

                            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate">
                                {monitor.name}
                            </h3>

                            {monitor.is_up !== null && (
                                <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-xs font-medium flex-shrink-0 ${monitor.is_up
                                    ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                    : 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                    }`}>
                                    {monitor.is_up ? 'Up' : 'Down'}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-1">
                        {stats && (
                            <span className="text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-300 flex-shrink-0">
                                {stats.uptime_percent.toFixed(1)}%
                            </span>
                        )}
                        <button
                            onClick={handleEdit}
                            className="p-1 sm:p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors flex-shrink-0"
                            title="Edit"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </button>
                        <button
                            onClick={handleDelete}
                            className="p-1 sm:p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                            title="Delete"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Uptime Status Bar - Always Visible */}
                {
                    !loading && responseTimes.length > 0 && (
                        <div className="mb-1.5">
                            <UptimeStatusBar checks={responseTimes} />
                        </div>
                    )}

                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>7 days ago</span>
                    <div className="flex items-center gap-1.5">
                        <span>{stats?.uptime_percent?.toFixed(2) || 0}% uptime</span>
                        {cacheStatus && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                cacheStatus === 'HIT' 
                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' 
                                    : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
                            }`}>
                                {cacheStatus === 'HIT' ? '⚡ CDN' : '🔄 Fresh'}
                            </span>
                        )}
                    </div>
                    <span>Today</span>
                </div>
            </div>

            {/* Expanded View - Details */}
            {
                expanded && (
                    <div className="border-t border-gray-200 dark:border-gray-700 p-3 sm:p-4 bg-gray-50 dark:bg-gray-800/50">
                        {/* Monitor Details */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs mb-3">
                            <div className="col-span-2">
                                <span className="text-gray-500 dark:text-gray-400">
                                    {monitor.method === 'TCP_PING' ? 'Target:' : 'URL:'}
                                </span>
                                <p className="font-mono text-blue-600 dark:text-blue-400 truncate text-xs">
                                    {monitor.method === 'TCP_PING' ? (monitor.target || monitor.url) : monitor.url}
                                </p>
                            </div>
                            <div>
                                <span className="text-gray-500 dark:text-gray-400">Method:</span>
                                <p className="font-medium">
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${monitor.method === 'TCP_PING'
                                        ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                                        : 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                                        }`}>
                                        {monitor.method}
                                    </span>
                                </p>
                            </div>
                            <div>
                                <span className="text-gray-500 dark:text-gray-400">Interval:</span>
                                <p>{monitor.interval_seconds}s</p>
                            </div>
                            {stats && (
                                <div>
                                    <span className="text-gray-500 dark:text-gray-400">Avg Latency:</span>
                                    <p>{stats.avg_latency_ms?.toFixed(0) || 0}ms</p>
                                </div>
                            )}
                        </div>

                        {/* Response Time Chart */}
                        {responseTimes.length > 0 ? (
                            <div className="mt-3">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                        Response times (last 7 days)
                                    </h4>
                                    <button
                                        onClick={handleRefresh}
                                        className="px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                    >
                                        Refresh
                                    </button>
                                </div>
                                <ResponseTimeChart data={responseTimes} height={120} />
                            </div >
                        ) : (
                            <div className="flex items-center justify-center py-6">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                            </div>
                        )
                        }
                    </div >
                )
            }

            {
                loading && !expanded && (
                    <div className="px-4 pb-4">
                        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                    </div>
                )
            }
        </div >
    )
}
