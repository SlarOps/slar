'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../ui';
import {
  MagnifyingGlassIcon,
  TrashIcon,
  PlayIcon,
  StopIcon,
  PlusIcon,
  EyeIcon,
  PencilIcon
} from '@heroicons/react/24/outline';
import {
  getMCPServersFromDB,
  saveMCPServerToDB,
  deleteMCPServerFromDB
} from '../../lib/workspaceManager';
import MCPServerModal from './MCPServerModal';
import MCPServerDetailModal from './MCPServerDetailModal';

export default function MCPServersTab() {
  const { session } = useAuth();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedServer, setSelectedServer] = useState(null);

  useEffect(() => {
    loadMCPServers();
  }, [session]);

  const loadMCPServers = async () => {
    if (!session?.user?.id) return;

    setLoading(true);
    try {
      // Load from PostgreSQL (instant, no S3 lag!)
      const result = await getMCPServersFromDB(session.user.id);
      if (result.success && result.config) {
        // Convert mcpServers object to array
        const serversArray = Object.entries(result.config.mcpServers || {}).map(([name, config]) => ({
          name,
          ...config,
          enabled: true // All servers in config are considered enabled
        }));
        setServers(serversArray);
      } else {
        toast.error('Failed to load MCP servers');
      }
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
      toast.error('Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleServer = async (serverName) => {
    if (!session?.user?.id) return;

    try {
      const server = servers.find(s => s.name === serverName);

      if (server.enabled) {
        // Remove server (disable) - delete from PostgreSQL
        const deleteResult = await deleteMCPServerFromDB(session.user.id, serverName);
        if (deleteResult.success) {
          // Remove from UI
          setServers(servers.filter(s => s.name !== serverName));
          toast.success('Server disabled');
        } else {
          toast.error('Failed to disable server');
        }
      } else {
        // Add server (enable) - save to PostgreSQL
        const serverConfig = {
          server_type: server.type || 'stdio',
          ...(server.type === 'stdio' || !server.type ? {
            command: server.command,
            args: server.args || [],
            env: server.env || {}
          } : {
            url: server.url,
            headers: server.headers || {}
          })
        };

        const saveResult = await saveMCPServerToDB(session.user.id, serverName, serverConfig);
        if (saveResult.success) {
          setServers(servers.map(s =>
            s.name === serverName ? { ...s, enabled: true } : s
          ));
          toast.success('Server enabled');
        } else {
          toast.error('Failed to enable server');
        }
      }
    } catch (error) {
      console.error('Failed to toggle server:', error);
      toast.error('Failed to toggle server');
    }
  };

  const handleDeleteServer = async (serverName) => {
    if (!session?.user?.id) return;
    if (!confirm('Are you sure you want to remove this MCP server?')) return;

    try {
      // Delete from PostgreSQL (instant, no S3 lag!)
      const deleteResult = await deleteMCPServerFromDB(session.user.id, serverName);
      if (deleteResult.success) {
        setServers(servers.filter(s => s.name !== serverName));
        toast.success('Server removed successfully');
      } else {
        toast.error('Failed to remove server');
      }
    } catch (error) {
      console.error('Failed to remove server:', error);
      toast.error('Failed to remove server');
    }
  };

  const handleServerCreated = (newServer) => {
    loadMCPServers(); // Reload the list
  };

  const handleServerUpdated = (updatedServer) => {
    loadMCPServers(); // Reload the list
  };

  const handleViewDetails = (server) => {
    setSelectedServer(server);
    setIsDetailModalOpen(true);
  };

  const handleEditServer = (server) => {
    setSelectedServer(server);
    setIsDetailModalOpen(false);
    setIsEditModalOpen(true);
  };

  const filteredServers = servers.filter(server => {
    const matchesSearch = server.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         server.command.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

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
      {/* Header with Add Button and Search */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="flex-1 relative">
          <MagnifyingGlassIcon className="absolute left-2 sm:left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name or command..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-2 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center justify-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
        >
          <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
          <span>Add Server</span>
        </button>
      </div>

      {/* Servers List */}
      {filteredServers.length > 0 ? (
        <div className="space-y-2">
          {filteredServers.map((server) => (
            <div
              key={server.name}
              className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 sm:p-4 hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1 sm:gap-2 mb-2">
                    <h3 className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white font-mono truncate">
                      {server.name}
                    </h3>
                    <span className={`px-1.5 sm:px-2 py-0.5 text-xs rounded flex-shrink-0 ${
                      server.enabled
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
                    }`}>
                      {server.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                  <div className="space-y-1">

                    {server.args && server.args.length > 0 && (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Args:</span>{' '}
                        <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-900 rounded font-mono break-all">
                          {server.args.join(' ')}
                        </code>
                      </div>
                    )}
                    {server.env && Object.keys(server.env).length > 0 && (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Env:</span>{' '}
                        {Object.keys(server.env).length} variable(s)
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 sm:gap-2 sm:ml-4 flex-shrink-0">
                  <button
                    onClick={() => handleViewDetails(server)}
                    className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    title="View details"
                  >
                    <EyeIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleEditServer(server)}
                    className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/20 rounded transition-colors"
                    title="Edit"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  {server.enabled ? (
                    <button
                      onClick={() => handleToggleServer(server.name)}
                      className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Disable server"
                    >
                      <StopIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleToggleServer(server.name)}
                      className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                      title="Enable server"
                    >
                      <PlayIcon className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteServer(server.name)}
                    className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                    title="Remove"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 sm:py-12 px-4 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <h3 className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">
            No MCP servers configured
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            MCP servers provide external tools and context to your AI agent
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-4 inline-flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            <span>Add Your First Server</span>
          </button>
        </div>
      )}

      {/* Modals */}
      <MCPServerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        mode="create"
        onServerCreated={handleServerCreated}
      />

      <MCPServerModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedServer(null);
        }}
        mode="edit"
        server={selectedServer}
        onServerUpdated={handleServerUpdated}
      />

      <MCPServerDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedServer(null);
        }}
        server={selectedServer}
        onEdit={handleEditServer}
      />
    </div>
  );
}
