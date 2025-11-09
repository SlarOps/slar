'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../ui';
import {
  MagnifyingGlassIcon,
  TrashIcon,
  ArrowTopRightOnSquareIcon
} from '@heroicons/react/24/outline';
import {
  getInstalledPluginsFromDB,
  removeInstalledPluginFromDB,
  addInstalledPluginToDB,
  deletePluginFiles
} from '../../lib/workspaceManager';

export default function InstalledPluginsTab() {
  const { session } = useAuth();
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadPlugins();
  }, [session]);

  const loadPlugins = async () => {
    if (!session?.user?.id) return;

    setLoading(true);
    try {
      // NEW: Load from PostgreSQL (instant, no lag!)
      const result = await getInstalledPluginsFromDB(session.user.id);
      if (result.success) {
        // PostgreSQL returns array directly with proper format
        // Map DB fields to component format
        const pluginsArray = result.plugins.map(plugin => ({
          id: plugin.id, // UUID from PostgreSQL
          name: plugin.plugin_name,
          marketplace: plugin.marketplace_name,
          version: plugin.version,
          installPath: plugin.install_path,
          status: plugin.status,
          installedAt: plugin.installed_at,
          lastUpdated: plugin.last_updated,
          isLocal: plugin.is_local,
          gitCommitSha: plugin.git_commit_sha
        }));
        setPlugins(pluginsArray);
      } else {
        toast.error('Failed to load installed plugins');
      }
    } catch (error) {
      console.error('Failed to load plugins:', error);
      toast.error('Failed to load installed plugins');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePlugin = async (pluginId) => {
    if (!session?.user?.id) return;

    try {
      const plugin = plugins.find(p => p.id === pluginId);
      if (!plugin) return;

      const newStatus = plugin.status === 'active' ? 'inactive' : 'active';

      // Update in PostgreSQL using upsert
      const result = await addInstalledPluginToDB(session.user.id, {
        name: plugin.name,
        marketplaceName: plugin.marketplace,
        version: plugin.version,
        installPath: plugin.installPath,
        status: newStatus,
        isLocal: plugin.isLocal,
        gitCommitSha: plugin.gitCommitSha
      });

      if (result.success) {
        setPlugins(plugins.map(p =>
          p.id === pluginId ? { ...p, status: newStatus } : p
        ));
        toast.success(`Plugin ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      } else {
        toast.error('Failed to toggle plugin');
      }
    } catch (error) {
      console.error('Failed to toggle plugin:', error);
      toast.error('Failed to toggle plugin');
    }
  };

  const handleDeletePlugin = async (pluginId) => {
    if (!session?.user?.id) return;
    if (!confirm('Are you sure you want to uninstall this plugin?')) return;

    try {
      const plugin = plugins.find(p => p.id === pluginId);
      if (!plugin) return;

      // Remove from PostgreSQL database (instant!)
      const removeResult = await removeInstalledPluginFromDB(session.user.id, pluginId);

      if (removeResult.success) {
        // Delete plugin files from S3 storage
        if (plugin.marketplace) {
          const pluginDir = `${plugin.marketplace}/${plugin.name}`;
          await deletePluginFiles(session.user.id, pluginDir);
        }

        setPlugins(plugins.filter(p => p.id !== pluginId));
        toast.success('Plugin uninstalled successfully');
      } else {
        toast.error('Failed to uninstall plugin');
      }
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      toast.error('Failed to uninstall plugin');
    }
  };


  const filteredPlugins = plugins.filter(plugin => {
    const matchesSearch = plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (plugin.repository && plugin.repository.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSearch;
  });

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="search"
          placeholder="Search by name or repository..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Plugins List */}
      {filteredPlugins.length > 0 ? (
        <div className="space-y-2">
          {filteredPlugins.map((plugin) => (
            <div
              key={plugin.id}
              className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                      {plugin.name}
                    </h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      v{plugin.version}
                    </span>
                    {plugin.marketplace && (
                      <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded">
                        {plugin.marketplace}
                      </span>
                    )}
                    {plugin.status && (
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        plugin.status === 'active'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
                      }`}>
                        {plugin.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                    {plugin.installPath || 'No install path'}
                  </p>
                  {plugin.installedAt && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Installed: {new Date(plugin.installedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-4">
                  {plugin.status && (
                    <button
                      onClick={() => handleTogglePlugin(plugin.id)}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                        plugin.status === 'active'
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {plugin.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeletePlugin(plugin.id)}
                    className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                    title="Uninstall"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            No plugins installed
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Install plugins from the Marketplace tab
          </p>
        </div>
      )}
    </div>
  );
}
