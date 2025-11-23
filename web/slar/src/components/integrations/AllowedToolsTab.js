import { useState, useEffect } from 'react';
import { TrashIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import apiClient from '../../lib/api';

export default function AllowedToolsTab() {
    const [tools, setTools] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [newToolName, setNewToolName] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    useEffect(() => {
        fetchTools();
    }, []);

    const fetchTools = async () => {
        try {
            setIsLoading(true);
            const response = await apiClient.getAllowedTools();
            if (response.success) {
                setTools(response.tools || []);
            } else {
                setError(response.error || 'Failed to load allowed tools');
            }
        } catch (err) {
            setError(err.message || 'Failed to load allowed tools');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!newToolName.trim()) return;

        try {
            setIsAdding(true);
            const response = await apiClient.addAllowedTool(newToolName.trim());
            if (response.success) {
                setTools(prev => [...prev, newToolName.trim()]);
                setNewToolName('');
            } else {
                alert(response.message || 'Failed to add tool');
            }
        } catch (err) {
            alert(err.message || 'Failed to add tool');
        } finally {
            setIsAdding(false);
        }
    };

    const handleRemove = async (toolName) => {
        if (!confirm(`Are you sure you want to remove permission for "${toolName}"? The agent will ask for approval next time it tries to use this tool.`)) {
            return;
        }

        try {
            const response = await apiClient.removeAllowedTool(toolName);
            if (response.success) {
                setTools(prev => prev.filter(t => t !== toolName));
            } else {
                alert(response.message || 'Failed to remove tool');
            }
        } catch (err) {
            alert(err.message || 'Failed to remove tool');
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-red-600 dark:text-red-400">{error}</p>
                <button
                    onClick={fetchTools}
                    className="mt-2 text-sm text-red-700 dark:text-red-300 hover:underline"
                >
                    Try again
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                        Always Allowed Tools
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        These tools can be executed by the agent without asking for your permission.
                    </p>
                </div>

                <div className="p-4 sm:p-6 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                    <form onSubmit={handleAdd} className="flex gap-3">
                        <input
                            type="text"
                            value={newToolName}
                            onChange={(e) => setNewToolName(e.target.value)}
                            placeholder="Enter tool name (e.g., mcp__incident_tools__get_incidents)"
                            className="flex-1 rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:ring-blue-500 focus:border-blue-500 dark:text-white"
                        />
                        <button
                            type="submit"
                            disabled={isAdding || !newToolName.trim()}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isAdding ? 'Adding...' : 'Add Tool'}
                        </button>
                    </form>
                </div>

                {tools.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                        <CheckCircleIcon className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
                        <p>No tools are currently in the allowed list.</p>
                        <p className="text-sm mt-1">
                            Add tools manually above or click "Always Allow" when the agent asks for permission.
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                        {tools.map((tool) => (
                            <li key={tool} className="flex items-center justify-between p-4 sm:p-6 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                                        <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                                            {tool}
                                        </p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                                            Auto-approved
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRemove(tool)}
                                    className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                    title="Revoke permission"
                                >
                                    <TrashIcon className="h-5 w-5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
