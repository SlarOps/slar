'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal, ModalFooter, ModalButton, Input, toast } from '../ui';
import {
  ServerIcon,
  CommandLineIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';
import {
  getMCPServersFromDB,
  saveMCPServerToDB,
  deleteMCPServerFromDB
} from '../../lib/workspaceManager';

const DEFAULT_CONFIGS = {
  command: {
    command: "node",
    args: ["path/to/server.js"],
    env: {
      "API_KEY": "your_api_key"
    }
  },
  sse: {
    type: "sse",
    url: "https://api.example.com/mcp/sse",
    headers: {
      "Authorization": "Bearer ${API_TOKEN}"
    }
  },
  http: {
    type: "http",
    url: "https://api.example.com/mcp",
    headers: {
      "X-API-Key": "${API_KEY}"
    }
  }
};

export default function MCPServerModal({
  isOpen,
  onClose,
  mode = 'create', // 'create' or 'edit'
  server = null,
  onServerCreated,
  onServerUpdated
}) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [serverName, setServerName] = useState('');
  const [configJson, setConfigJson] = useState('');
  const [jsonError, setJsonError] = useState('');

  const isEditMode = mode === 'edit';
  const modalTitle = isEditMode ? 'Edit MCP Server' : 'Add New MCP Server';
  const submitButtonText = isEditMode ? 'Update Server' : 'Add Server';

  // Initialize form data when modal opens or server changes
  useEffect(() => {
    if (isOpen) {
      if (isEditMode && server) {
        setServerName(server.name || '');
        // Extract config (everything except name and enabled)
        const { name, enabled, ...config } = server;
        setConfigJson(JSON.stringify(config, null, 2));
      } else {
        // Reset for create mode
        setServerName('');
        setConfigJson(JSON.stringify(DEFAULT_CONFIGS.command, null, 2));
      }
      setJsonError('');
    }
  }, [isOpen, isEditMode, server]);

  const validateJson = (jsonString) => {
    try {
      const parsed = JSON.parse(jsonString);
      setJsonError('');
      return { valid: true, data: parsed };
    } catch (error) {
      setJsonError(error.message);
      return { valid: false, data: null };
    }
  };

  const handleJsonChange = (value) => {
    setConfigJson(value);
    validateJson(value);
  };

  const handleLoadTemplate = (template) => {
    setConfigJson(JSON.stringify(DEFAULT_CONFIGS[template], null, 2));
    setJsonError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!session?.user?.id) {
      toast.error('Authentication required');
      return;
    }

    if (!serverName.trim()) {
      toast.error('Server name is required');
      return;
    }

    // Validate JSON
    const { valid, data: config } = validateJson(configJson);
    if (!valid) {
      toast.error('Invalid JSON configuration');
      return;
    }

    setLoading(true);
    try {
      // Detect server type from config
      let serverType = 'stdio';  // default
      if (config.type === 'sse') {
        serverType = 'sse';
      } else if (config.type === 'http') {
        serverType = 'http';
      } else if (config.command) {
        serverType = 'stdio';
      }

      // Build server config for API
      const serverConfig = {
        server_type: serverType
      };

      if (serverType === 'stdio') {
        serverConfig.command = config.command;
        serverConfig.args = config.args || [];
        serverConfig.env = config.env || {};
      } else {
        serverConfig.url = config.url;
        serverConfig.headers = config.headers || {};
      }

      // If editing and name changed, delete old server first
      if (isEditMode && server.name !== serverName) {
        try {
          await deleteMCPServerFromDB(session.user.id, server.name);
        } catch (deleteError) {
          console.error('Failed to delete old server:', deleteError);
          // Continue anyway - the save will update if old name still exists
        }
      }

      // Save to PostgreSQL (instant, no S3 lag!)
      const saveResult = await saveMCPServerToDB(
        session.user.id,
        serverName,
        serverConfig
      );

      if (saveResult.success) {
        if (isEditMode) {
          onServerUpdated && onServerUpdated({ name: serverName, ...config });
          toast.success('MCP server updated successfully!');
        } else {
          onServerCreated && onServerCreated({ name: serverName, ...config });
          toast.success('MCP server added successfully!');
        }
        onClose();
      } else {
        toast.error('Failed to save server configuration');
      }
    } catch (error) {
      console.error(`Failed to ${isEditMode ? 'update' : 'create'} MCP server:`, error);
      toast.error(`Failed to ${isEditMode ? 'update' : 'create'} MCP server: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="lg"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            Cancel
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            disabled={loading || !serverName.trim() || !!jsonError || !configJson.trim()}
          >
            {submitButtonText}
          </ModalButton>
        </ModalFooter>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Server Name */}
        <Input
          label="Server Name"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          placeholder="e.g., github, filesystem, postgres"
          required
          icon={<ServerIcon className="h-5 w-5" />}
          helperText="A unique identifier for this MCP server"
        />

        {/* Templates */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Quick Templates
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleLoadTemplate('command')}
              className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <CommandLineIcon className="h-4 w-4 inline mr-1" />
              Command
            </button>
            <button
              type="button"
              onClick={() => handleLoadTemplate('sse')}
              className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              SSE
            </button>
            <button
              type="button"
              onClick={() => handleLoadTemplate('http')}
              className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              HTTP
            </button>
          </div>
        </div>

        {/* JSON Configuration */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <CodeBracketIcon className="h-5 w-5 inline mr-1" />
            Configuration (JSON)
          </label>
          <textarea
            value={configJson}
            onChange={(e) => handleJsonChange(e.target.value)}
            rows={12}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            placeholder="Enter JSON configuration..."
            spellCheck={false}
          />
          {jsonError && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              ✗ Invalid JSON: {jsonError}
            </p>
          )}
          {!jsonError && configJson && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              ✓ Valid JSON
            </p>
          )}
        </div>

        {/* Info Message */}
        <div className="p-4 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                MCP Server Types
              </h4>
              <ul className="text-sm text-blue-700 dark:text-blue-300 mt-1 space-y-1">
                <li><strong>Command:</strong> Local server with command, args, env</li>
                <li><strong>SSE:</strong> Remote server with type: "sse", url, headers</li>
                <li><strong>HTTP:</strong> Remote server with type: "http", url, headers</li>
              </ul>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
