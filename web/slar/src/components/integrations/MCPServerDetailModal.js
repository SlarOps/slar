'use client';

import { useState } from 'react';
import { Modal, ModalFooter, ModalButton } from '../ui';
import {
  ServerIcon,
  CommandLineIcon,
  ClipboardDocumentIcon,
  CubeIcon,
  CheckCircleIcon,
  XCircleIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';

export default function MCPServerDetailModal({
  isOpen,
  onClose,
  server,
  onEdit
}) {
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);

  if (!server) return null;

  // Determine server type
  const serverType = server.type || (server.command ? 'command' : 'unknown');
  const serverConfig = { ...server };
  delete serverConfig.name;
  delete serverConfig.enabled;

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'command') {
        setCopiedCommand(true);
        setTimeout(() => setCopiedCommand(false), 2000);
      } else if (type === 'env') {
        setCopiedEnv(true);
        setTimeout(() => setCopiedEnv(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const copyJsonConfig = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(serverConfig, null, 2));
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch (err) {
      console.error('Failed to copy JSON: ', err);
    }
  };

  const fullCommand = server.command
    ? `${server.command}${server.args && server.args.length > 0 ? ' ' + server.args.join(' ') : ''}`
    : null;

  const getStatusIcon = (enabled) => {
    return enabled
      ? <CheckCircleIcon className="h-6 w-6 text-green-500" />
      : <XCircleIcon className="h-6 w-6 text-gray-500" />;
  };

  const getStatusText = (enabled) => {
    return enabled ? 'Enabled' : 'Disabled';
  };

  const getServerTypeLabel = (type) => {
    switch (type) {
      case 'sse': return 'SSE Server';
      case 'http': return 'HTTP Server';
      case 'command': return 'Command-based Server';
      default: return 'MCP Server';
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="MCP Server Details"
      size="lg"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            Close
          </ModalButton>
          <ModalButton variant="primary" onClick={() => onEdit(server)}>
            Edit Server
          </ModalButton>
        </ModalFooter>
      }
    >
      <div className="space-y-6">
        {/* Server Header */}
        <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="p-3 rounded-lg bg-white dark:bg-gray-700 shadow-sm">
            <ServerIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white font-mono">
              {server.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {getServerTypeLabel(serverType)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon(server.enabled)}
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {getStatusText(server.enabled)}
            </span>
          </div>
        </div>

        {/* JSON Configuration */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <CodeBracketIcon className="h-5 w-5 inline mr-2" />
            Configuration
          </label>
          <div className="relative">
            <pre className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg overflow-auto max-h-96 text-sm font-mono text-gray-800 dark:text-gray-200">
              {JSON.stringify(serverConfig, null, 2)}
            </pre>
            <button
              onClick={copyJsonConfig}
              className="absolute top-2 right-2 p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Copy configuration"
            >
              <ClipboardDocumentIcon className="h-5 w-5" />
            </button>
          </div>
          {copiedCommand && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              ✓ Copied to clipboard
            </p>
          )}
        </div>

        {/* Quick Info based on type */}
        {serverType === 'command' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {server.args?.length || 0}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Arguments
              </div>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {Object.keys(server.env || {}).length}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Environment Variables
              </div>
            </div>
          </div>
        )}

        {(serverType === 'sse' || serverType === 'http') && (
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="text-sm font-bold text-gray-900 dark:text-white break-all">
                {server.url}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Server URL
              </div>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {Object.keys(server.headers || {}).length}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Headers
              </div>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="p-4 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                About MCP Servers
              </h4>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                Model Context Protocol (MCP) servers provide external tools, resources, and context to AI agents.
                This server will be started automatically when your agent needs access to its capabilities.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
