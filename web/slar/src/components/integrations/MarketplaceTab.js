'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../ui';
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  PlusIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LinkIcon
} from '@heroicons/react/24/outline';
import apiClient from '../../lib/api';
import {
  fetchPluginsFromMarketplace,
  parseGitHubUrl,
  fetchMarketplaceMetadata,
  updateMarketplace
} from '../../lib/marketplaceGithub';
import {
  getInstalledPluginsFromDB,
  loadMarketplaceFromDB
} from '../../lib/workspaceManager';

const DEFAULT_MARKETPLACES = [];

export default function MarketplaceTab() {
  const { session } = useAuth();
  const [marketplaces, setMarketplaces] = useState([]);
  const [marketplaceData, setMarketplaceData] = useState({});
  const [installedPluginIds, setInstalledPluginIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedPlugins, setExpandedPlugins] = useState(new Set());
  const [cachedMarketplaces, setCachedMarketplaces] = useState(new Set());

  // Add marketplace form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [addingRepo, setAddingRepo] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);

  // Update marketplace state
  const [updatingMarketplaces, setUpdatingMarketplaces] = useState(new Set());

  useEffect(() => {
    loadMarketplaces();
  }, [session]);

  const loadMarketplaces = async () => {
    setLoading(true);

    try {
      // Load marketplaces from database (no localStorage cache)
      let userMarketplaces = DEFAULT_MARKETPLACES;

      if (session?.user?.id && session?.access_token) {
        apiClient.setToken(session.access_token);
        const dbMarketplaces = await apiClient.getAllMarketplaces();

        if (dbMarketplaces.success && dbMarketplaces.marketplaces) {
          // Transform DB format to component format
          userMarketplaces = dbMarketplaces.marketplaces.map(m => ({
            url: m.repository_url,
            branch: m.branch || 'main',
            name: m.name,
            fetchedAt: m.updated_at
          }));
          console.log('[MarketplaceTab] ✅ Loaded marketplaces from database:', userMarketplaces.length);
        }
      }

      console.log('[MarketplaceTab] 📋 User marketplaces:', userMarketplaces);
      console.log('[MarketplaceTab] 👤 Session user ID:', session?.user?.id);

      setMarketplaces(userMarketplaces);

      // Load installed plugins from PostgreSQL (instant!)
      if (session?.user?.id && session?.access_token) {
        const installedResult = await getInstalledPluginsFromDB(session.user.id, session.access_token);
        if (installedResult.success) {
          // Convert plugins array to set of plugin IDs
          const pluginIds = new Set();
          installedResult.plugins.forEach((plugin) => {
            // Create plugin key: pluginName@marketplaceName
            const pluginKey = `${plugin.plugin_name}@${plugin.marketplace_name}`;
            pluginIds.add(pluginKey);
          });
          setInstalledPluginIds(pluginIds);
        }
      }

      // Load plugins from each marketplace
      const data = {};
      const cached = new Set();

      for (const marketplace of userMarketplaces) {
        const parsed = parseGitHubUrl(marketplace.url);
        if (!parsed) continue;

        console.log('[MarketplaceTab] 🔍 Processing marketplace:', marketplace);

        // Try loading from PostgreSQL first (instant, no lag!)
        if (session?.user?.id && session?.access_token && marketplace.name) {
          console.log(`[MarketplaceTab] 💾 Loading marketplace "${marketplace.name}" from PostgreSQL...`);
          console.log(`[MarketplaceTab]    User ID: ${session.user.id}`);

          const dbResult = await loadMarketplaceFromDB(session.user.id, marketplace.name, session.access_token);

          console.log(`[MarketplaceTab] 📦 PostgreSQL result for "${marketplace.name}":`, dbResult);

          if (dbResult.success && dbResult.marketplace) {
            console.log(`[MarketplaceTab] ✅ Successfully loaded ${marketplace.name} from PostgreSQL (instant!)`);
            console.log(`[MarketplaceTab]    Display name: ${dbResult.marketplace.display_name}`);
            console.log(`[MarketplaceTab]    Plugins count: ${dbResult.marketplace.plugins?.length || 0}`);
            cached.add(marketplace.url);

            // Parse marketplace data - PostgreSQL stores in JSONB format
            const plugins = [];
            for (const plugin of (dbResult.marketplace.plugins || [])) {
              const pluginData = {
                id: `${parsed.owner}/${parsed.repo}/${plugin.name}`,
                name: plugin.name,
                description: plugin.description || 'No description available',
                source: plugin.source || './',
                strict: plugin.strict || false,
                skills: plugin.skills || [],
                repository: dbResult.marketplace.repository_url || `https://github.com/${parsed.owner}/${parsed.repo}`,
                repositoryOwner: parsed.owner,
                repositoryName: parsed.repo,
                branch: dbResult.marketplace.branch || 'main',
                marketplaceName: dbResult.marketplace.name,
                marketplaceOwner: dbResult.marketplace.display_name,
                version: dbResult.marketplace.version || '1.0.0'
              };
              plugins.push(pluginData);
            }

            data[marketplace.url] = {
              marketplace: {
                name: dbResult.marketplace.display_name || dbResult.marketplace.name,
                description: dbResult.marketplace.description,
                version: dbResult.marketplace.version,
                owner: dbResult.marketplace.display_name,
                repository: dbResult.marketplace.repository_url
              },
              plugins
            };

            continue; // Skip GitHub fetch
          } else {
            console.log(`[MarketplaceTab] ❌ Failed to load from PostgreSQL:`, dbResult.error || 'Unknown error');
            console.log(`[MarketplaceTab]    Will fallback to GitHub API`);
          }
        } else {
          console.log(`[MarketplaceTab] ⏭️  Skipping PostgreSQL check for ${marketplace.url}:`, {
            hasSession: !!session?.user?.id,
            hasName: !!marketplace.name,
            marketplaceName: marketplace.name || '(missing)'
          });
        }

        // Fallback to GitHub if not in PostgreSQL
        console.log(`[MarketplaceTab] ⚠️ Fetching marketplace ${parsed.repo} from GitHub API...`);
        console.warn('[MarketplaceTab] ⚠️ WARNING: GitHub API has rate limits (60 requests/hour). Use PostgreSQL caching instead.');
        const result = await fetchPluginsFromMarketplace(
          parsed.owner,
          parsed.repo,
          marketplace.branch || 'main'
        );

        if (result) {
          data[marketplace.url] = result;
        }
      }

      setMarketplaceData(data);
      setCachedMarketplaces(cached);

      // Toast removed - UI already shows loaded marketplaces
      // if (Object.keys(data).length > 0) {
      //   toast.success(`Loaded ${Object.keys(data).length} marketplace(s)`);
      // }
    } catch (error) {
      console.error('Failed to load marketplaces:', error);
      toast.error('Failed to load marketplaces');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMarketplace = async () => {
    if (!session?.user?.id) {
      toast.error('Please sign in to add marketplace');
      return;
    }

    if (!newRepoUrl.trim()) {
      toast.error('Please enter a GitHub repository URL');
      return;
    }

    const parsed = parseGitHubUrl(newRepoUrl);
    if (!parsed) {
      toast.error('Invalid GitHub URL');
      return;
    }

    setAddingRepo(true);
    setDownloadProgress({ current: 1, total: 1, skillName: 'Fetching marketplace metadata...' });

    try {
      // Set auth token for API client
      apiClient.setToken(session?.access_token);

      // Infer marketplace name from URL
      const inferredMarketplaceName = `${parsed.owner}-${parsed.repo}`;

      // DOWNLOAD ENTIRE MARKETPLACE (ZIP + Metadata) via API
      // Backend downloads ZIP from GitHub → Uploads to S3 → Saves metadata to PostgreSQL
      setDownloadProgress({ current: 1, total: 2, skillName: 'Downloading marketplace from GitHub...' });

      const downloadResult = await apiClient.downloadMarketplace({
        owner: parsed.owner,
        repo: parsed.repo,
        branch: 'main',
        marketplace_name: inferredMarketplaceName
      });

      if (!downloadResult.success) {
        throw new Error(downloadResult.error || 'Failed to download marketplace');
      }

      console.log('[MarketplaceTab] ✅ Marketplace downloaded:', downloadResult.marketplace);

      const marketplaceName = downloadResult.marketplaceName || downloadResult.marketplace?.name || inferredMarketplaceName;

      // Add to marketplaces list (UI state only - already saved to DB by backend)
      const newMarketplace = {
        url: newRepoUrl.trim(),
        branch: 'main',
        name: marketplaceName,
        fetchedAt: new Date().toISOString()
      };

      const updatedMarketplaces = [...marketplaces, newMarketplace];
      setMarketplaces(updatedMarketplaces);

      // Parse marketplace data for UI display
      const plugins = [];
      const marketplace = downloadResult.marketplace || {};

      for (const plugin of (marketplace.plugins || [])) {
        const pluginData = {
          id: `${parsed.owner}/${parsed.repo}/${plugin.name}`,
          name: plugin.name,
          description: plugin.description || 'No description available',
          source: plugin.source || './',
          strict: plugin.strict || false,
          skills: plugin.skills || [],
          repository: `https://github.com/${parsed.owner}/${parsed.repo}`,
          repositoryOwner: parsed.owner,
          repositoryName: parsed.repo,
          branch: 'main',
          marketplaceName: marketplaceName,
          marketplaceOwner: marketplace.owner?.name || marketplace.name || parsed.owner,
          version: marketplace.metadata?.version || '1.0.0'
        };
        plugins.push(pluginData);
      }

      // Add marketplace data for UI display
      setMarketplaceData({
        ...marketplaceData,
        [newMarketplace.url]: {
          marketplace: {
            name: marketplace.name || marketplaceName,
            description: marketplace.metadata?.description || marketplace.description,
            version: marketplace.metadata?.version || marketplace.version || '1.0.0',
            owner: marketplace.owner?.name || marketplace.name || parsed.owner,
            repository: `https://github.com/${parsed.owner}/${parsed.repo}`
          },
          plugins
        }
      });

      // Mark as cached (loaded from storage)
      setCachedMarketplaces(new Set([...cachedMarketplaces, newMarketplace.url]));

      toast.success(`Marketplace added with ZIP: ${plugins.length} plugin(s) available`);
      setNewRepoUrl('');
      setShowAddForm(false);
    } catch (error) {
      console.error('[MarketplaceTab] Failed to add marketplace:', error);
      toast.error(`Failed to add marketplace: ${error.message}`);
    } finally {
      setAddingRepo(false);
      setDownloadProgress(null);
    }
  };

  const handleRemoveMarketplace = async (marketplaceUrl) => {
    if (!confirm('Delete this marketplace? This will remove all installed plugins and downloaded files. This action cannot be undone.')) {
      return;
    }

    // Find marketplace by URL
    const marketplace = marketplaces.find(m => m.url === marketplaceUrl);
    if (!marketplace || !marketplace.name) {
      toast.error('Marketplace name not found. Cannot delete.');
      return;
    }

    const marketplaceName = marketplace.name;
    let toastId;

    try {
      toastId = toast.loading(`Deleting marketplace "${marketplaceName}"...`);

      // Set auth token and call async delete API (enqueues cleanup task to PGMQ)
      apiClient.setToken(session?.access_token);
      const result = await apiClient.deleteMarketplace(marketplaceName);

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete marketplace');
      }

      console.log(`[MarketplaceTab] ✅ Marketplace deletion initiated (job_id: ${result.job_id})`);

      // Update UI immediately (optimistic update - already deleted from DB by backend)
      const updatedMarketplaces = marketplaces.filter(m => m.url !== marketplaceUrl);
      setMarketplaces(updatedMarketplaces);

      // Remove marketplace data from state
      const newData = { ...marketplaceData };
      delete newData[marketplaceUrl];
      setMarketplaceData(newData);

      // Remove from cached list
      const newCached = new Set(cachedMarketplaces);
      newCached.delete(marketplaceUrl);
      setCachedMarketplaces(newCached);

      if (toastId) toast.dismiss(toastId);
      toast.success(`Marketplace "${marketplaceName}" deletion initiated. Cleanup running in background.`);
    } catch (error) {
      console.error('[MarketplaceTab] Failed to delete marketplace:', error);
      if (toastId) toast.dismiss(toastId);
      toast.error(`Failed to delete marketplace: ${error.message}`);
    }
  };

  const handleUpdateMarketplace = async (marketplaceUrl) => {
    const marketplace = marketplaces.find(m => m.url === marketplaceUrl);
    if (!marketplace || !marketplace.name) {
      toast.error('Marketplace name not found. Cannot update.');
      return;
    }

    const marketplaceName = marketplace.name;

    // Add to updating set
    setUpdatingMarketplaces(prev => new Set(prev).add(marketplaceUrl));

    let toastId;
    try {
      toastId = toast.loading(`Updating "${marketplaceName}"...`);

      const result = await updateMarketplace(marketplaceName, session?.access_token);

      if (!result.success) {
        throw new Error(result.error || 'Failed to update marketplace');
      }

      if (toastId) toast.dismiss(toastId);

      if (result.hadChanges) {
        toast.success(`Marketplace "${marketplaceName}" updated! (${result.oldCommitSha?.slice(0, 7)} → ${result.newCommitSha?.slice(0, 7)})`);
        // Reload marketplace data to reflect changes
        await loadMarketplaces();
      } else {
        toast.success(`Marketplace "${marketplaceName}" is already up to date.`);
      }
    } catch (error) {
      console.error('[MarketplaceTab] Failed to update marketplace:', error);
      if (toastId) toast.dismiss(toastId);
      toast.error(`Failed to update marketplace: ${error.message}`);
    } finally {
      // Remove from updating set
      setUpdatingMarketplaces(prev => {
        const newSet = new Set(prev);
        newSet.delete(marketplaceUrl);
        return newSet;
      });
    }
  };

  const handleRefreshMarketplaces = async () => {
    await loadMarketplaces();
    toast.success('Marketplaces refreshed');
  };

  const togglePlugin = (pluginId) => {
    const newExpanded = new Set(expandedPlugins);
    if (newExpanded.has(pluginId)) {
      newExpanded.delete(pluginId);
    } else {
      newExpanded.add(pluginId);
    }
    setExpandedPlugins(newExpanded);
  };

  const handleInstallPlugin = async (plugin) => {
    if (!session?.user?.id) {
      toast.error('Please sign in to install plugins');
      return;
    }

    let toastId;
    try {
      // Create plugin key: pluginName@marketplaceName
      const pluginKey = `${plugin.name}@${plugin.marketplaceName}`;

      toastId = toast.loading(`Installing ${plugin.name}...`);

      // GIT APPROACH (FAST & EFFICIENT):
      // - Plugin files already exist in workspace (from git clone)
      // - This only marks the plugin as installed in PostgreSQL (instant!)
      // - No unzipping needed - files are ready to use
      // - Installing a plugin gives access to ALL skills inside it

      console.log('[MarketplaceTab] 📦 Installing plugin (instant DB update):', {
        userId: session.user.id,
        pluginName: plugin.name,
        marketplaceName: plugin.marketplaceName,
        version: plugin.version,
        skillsCount: plugin.skills.length
      });

      // Set auth token and call install endpoint (only updates database)
      apiClient.setToken(session?.access_token);
      const installResult = await apiClient.installPlugin(
        plugin.marketplaceName,
        plugin.name,  // Plugin name (e.g., "document-skills", "example-skills")
        plugin.version
      );

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to install plugin');
      }

      console.log('[MarketplaceTab] ✅ Plugin installed (instant!):', installResult.plugin);

      // Update UI
      setInstalledPluginIds(new Set([...installedPluginIds, pluginKey]));
      if (toastId) toast.dismiss(toastId);
      toast.success(`${plugin.name} installed successfully! (${plugin.skills.length} skills included)`);
    } catch (error) {
      console.error('[MarketplaceTab] Install error:', error);
      if (toastId) toast.dismiss(toastId);
      toast.error(`Failed to install: ${error.message}`);
    }
  };

  const filteredData = Object.entries(marketplaceData).reduce((acc, [url, data]) => {
    if (!data || !data.plugins) return acc;

    const filteredPlugins = data.plugins.filter(plugin => {
      return plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        plugin.description.toLowerCase().includes(searchTerm.toLowerCase());
    });

    if (filteredPlugins.length > 0) {
      acc[url] = {
        ...data,
        plugins: filteredPlugins
      };
    }

    return acc;
  }, {});

  if (loading) {
    return (
      <div className="space-y-2 sm:space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 sm:p-4 animate-pulse">
            <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
            <div className="h-2 sm:h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header with Search and Add Button */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="flex-1 relative">
          <MagnifyingGlassIcon className="absolute left-2 sm:left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
          <input
            type="search"
            placeholder="Search plugins and skills..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-2 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center justify-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
        >
          <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
          <span>Add Marketplace</span>
        </button>
      </div>

      {/* Cache Status Info */}
      {cachedMarketplaces.size > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-2 sm:p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <button
              onClick={handleRefreshMarketplaces}
              className="text-xs text-green-700 dark:text-green-300 hover:underline text-left sm:text-right"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Add Marketplace Form */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4">
          <h3 className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white mb-2 sm:mb-3">
            Add GitHub Marketplace
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newRepoUrl}
              onChange={(e) => setNewRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="flex-1 px-2 sm:px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs sm:text-sm"
              onKeyPress={(e) => e.key === 'Enter' && !addingRepo && handleAddMarketplace()}
              disabled={addingRepo}
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddMarketplace}
                disabled={addingRepo}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-xs sm:text-sm font-medium"
              >
                {addingRepo ? 'Adding...' : 'Add'}
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                disabled={addingRepo}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors text-xs sm:text-sm"
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Download Progress */}
          {downloadProgress && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Fetching metadata from GitHub...
                </span>
                <span className="text-xs text-blue-700 dark:text-blue-300">
                  {downloadProgress.current}/{downloadProgress.total}
                </span>
              </div>
              <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2 mb-2">
                <div
                  className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all"
                  style={{ width: `${downloadProgress.total > 0 ? (downloadProgress.current / downloadProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                {downloadProgress.skillName}
              </p>
            </div>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Repository must contain .claude-plugin/marketplace.json file. All skills will be downloaded to your workspace.
          </p>
        </div>
      )}

      {/* Marketplaces List */}
      {Object.entries(filteredData).length > 0 ? (
        <div className="space-y-3 sm:space-y-4">
          {Object.entries(filteredData).map(([marketplaceUrl, data]) => (
            <div key={marketplaceUrl} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              {/* Marketplace Header */}
              <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                      <h3 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white">
                        {data.marketplace?.name || 'Marketplace'}
                      </h3>
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                        v{data.marketplace?.version || '1.0.0'}
                      </span>
                      {cachedMarketplaces.has(marketplaceUrl) && (
                        <span className="px-1.5 sm:px-2 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded flex-shrink-0">
                          Cached
                        </span>
                      )}
                    </div>
                    {data.marketplace?.description && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        {data.marketplace.description}
                      </p>
                    )}
                    <a
                      href={marketplaceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 break-all"
                    >
                      <LinkIcon className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{marketplaceUrl.replace('https://github.com/', '')}</span>
                    </a>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleUpdateMarketplace(marketplaceUrl)}
                      disabled={updatingMarketplaces.has(marketplaceUrl)}
                      className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
                      title="Update marketplace (git fetch)"
                    >
                      <ArrowPathIcon className={`h-4 w-4 ${updatingMarketplaces.has(marketplaceUrl) ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => handleRemoveMarketplace(marketplaceUrl)}
                      className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Remove marketplace"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Plugins List */}
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.plugins.map((plugin) => {
                  const isExpanded = expandedPlugins.has(plugin.id);
                  const pluginKey = `${plugin.name}@${plugin.marketplaceName}`;
                  const isInstalled = installedPluginIds.has(pluginKey);

                  return (
                    <div key={plugin.id}>
                      {/* Plugin Header */}
                      <div className="p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <div className="flex flex-col gap-3">
                          <div
                            className="flex-1 flex items-start gap-2 cursor-pointer"
                            onClick={() => togglePlugin(plugin.id)}
                          >
                            {isExpanded ? (
                              <ChevronDownIcon className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <ChevronRightIcon className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">
                                {plugin.name}
                              </h4>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                {plugin.description}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                {plugin.skills.length} skill(s) included
                              </p>
                            </div>
                          </div>

                          {/* Install button at plugin level */}
                          <div className="pl-6 sm:pl-7">
                            {isInstalled ? (
                              <span className="inline-flex px-2 sm:px-3 py-1.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded items-center gap-1.5">
                                <CheckCircleIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                                Installed
                              </span>
                            ) : (
                              <button
                                onClick={() => handleInstallPlugin(plugin)}
                                className="inline-flex px-2 sm:px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors items-center gap-1.5"
                              >
                                <ArrowDownTrayIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                                Install Plugin
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Skills List (Expanded) - Read-only, no install buttons */}
                      {isExpanded && (
                        <div className="px-3 sm:px-4 pb-3 sm:pb-4 bg-gray-50 dark:bg-gray-900/30">
                          <div className="space-y-2 ml-6 sm:ml-7">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                              Skills included in this plugin:
                            </p>
                            {plugin.skills.map((skillPath) => {
                              const skillName = skillPath.split('/').pop();
                              // Clean ./ prefix for display
                              const displayPath = skillPath.replace(/^\.\//, '');

                              return (
                                <div
                                  key={skillPath}
                                  className="flex items-center justify-between p-2 sm:p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
                                      {skillName}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5 truncate">
                                      {displayPath}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 sm:py-12 px-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">
            No plugins found
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {marketplaces.length === 0
              ? 'Add a marketplace to get started'
              : 'Try adjusting your search or add more marketplaces'}
          </p>
        </div>
      )}
    </div>
  );
}
