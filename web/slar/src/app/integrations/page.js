'use client';

import { useState, useEffect } from 'react';
import { toast } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import {
  downloadMCPConfig,
  checkMCPConfigExists,
  uploadMCPServersConfig,
  uploadSkillFile
} from '../../lib/mcpStorage';
import MCPJsonEditor from '../../components/MCPJsonEditor';
import SkillUploadModal from '../../components/SkillUploadModal';
import { DocumentPlusIcon } from '@heroicons/react/24/outline';

export default function ClaudeAgentConfigPage() {
  const { user, session } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [cloudConfigExists, setCloudConfigExists] = useState(false);
  const [mcpServersConfig, setMcpServersConfig] = useState({
    mcpServers: {
      "context7": {
        command: "npx",
        args: ["-y", "@uptudev/mcp-context7"],
        env: {}
      },
      "slar-incident-tools": {
        command: "python",
        args: ["/path/to/slar/api/ai/claude_agent_api_v1.py"],
        env: {
          OPENAI_API_KEY: "your-openai-api-key",
          PORT: "8002"
        }
      }
    }
  });
  const [isSavingMCP, setIsSavingMCP] = useState(false);
  const [showSkillUploadModal, setShowSkillUploadModal] = useState(false);

  useEffect(() => {
    loadConfig();
    checkCloudConfig();
  }, [user]);

  // Check if config exists in Supabase
  const checkCloudConfig = async () => {
    if (!user?.id) return;

    const result = await checkMCPConfigExists(user.id);
    setCloudConfigExists(result.exists);
  };

  // Load MCP config from Supabase Storage
  const loadConfig = async () => {
    setIsLoading(true);
    try {
      if (!user?.id) {
        return;
      }

      const result = await downloadMCPConfig(user.id);

      if (result.success && result.config?.mcpServers) {
        setMcpServersConfig({ mcpServers: result.config.mcpServers });
        toast.success('MCP configuration loaded from cloud');
      }
    } catch (error) {
      console.error('Failed to load MCP config:', error);
      toast.error('Failed to load MCP configuration');
    } finally {
      setIsLoading(false);
    }
  };

  // Save MCP servers configuration to Supabase
  const handleSaveMCPConfig = async (mcpConfig) => {
    if (!user?.id) {
      toast.error('Please login to save MCP configuration');
      return;
    }

    if (!session?.access_token) {
      toast.error('No active session. Please login again.');
      return;
    }

    setIsSavingMCP(true);
    try {
      // Step 1: Upload to Supabase Storage
      const result = await uploadMCPServersConfig(user.id, mcpConfig);

      if (result.success) {
        toast.success('MCP configuration saved to cloud');
        setCloudConfigExists(true);

        // Step 2: Trigger agent to sync the config
        try {
          const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
          const syncResponse = await fetch(`${agentApiUrl}/api/sync-mcp-config`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              auth_token: `Bearer ${session.access_token}`
            })
          });

          const syncData = await syncResponse.json();

          if (syncData.success) {
            toast.success(`Agent synced: ${syncData.servers_count} servers loaded`);
            console.log('✅ Agent sync successful:', syncData);
          } else {
            console.warn('⚠️  Agent sync failed:', syncData.message);
            toast.warning(`Saved to cloud, but agent sync failed: ${syncData.message}`);
          }
        } catch (syncError) {
          console.error('❌ Failed to sync with agent:', syncError);
          toast.warning('Saved to cloud, but could not sync with agent');
        }
      } else {
        toast.error(`Failed to save MCP config: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to save MCP config:', error);
      toast.error('Failed to save MCP configuration');
    } finally {
      setIsSavingMCP(false);
    }
  };

  // Handle skill upload
  const handleSkillUploaded = async (file) => {
    try {
      if (!user?.id) {
        throw new Error('User ID not found');
      }

      // Upload skill file to Supabase Storage
      const result = await uploadSkillFile(user.id, file);

      if (!result.success) {
        throw new Error(result.error || 'Failed to upload skill file');
      }

      toast.success('Skill file uploaded successfully!');

      // Call backend API to sync skills to workspace
      const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
      const syncResponse = await fetch(`${agentApiUrl}/api/sync-skills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_token: session.access_token
        })
      });

      const syncResult = await syncResponse.json();

      if (syncResult.success) {
        toast.success(`Skills synced: ${syncResult.synced_count} skill(s) extracted to workspace`);
      } else {
        toast.warning(`Skill uploaded but sync had issues: ${syncResult.message}`);
      }

    } catch (error) {
      console.error('Error uploading skill:', error);
      throw error;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Agent Configuration
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Configure your AI agent with custom skills and MCP servers
        </p>
      </div>

      {/* Agent Skills Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Agent Skills
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Upload custom skills (.skill or .zip) to extend your AI agent's capabilities
            </p>
          </div>
          <button
            onClick={() => setShowSkillUploadModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 border border-transparent rounded-lg transition-colors"
          >
            <DocumentPlusIcon className="h-4 w-4" />
            Upload Skill
          </button>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            Skills are custom commands and tools that extend your AI agent's capabilities.
            Upload .skill files or .zip archives containing multiple skills.
            They will be automatically extracted to your agent workspace and available in your next chat session.
          </p>
        </div>
      </div>

      {/* MCP Configuration Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              MCP Configuration
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Configure Model Context Protocol servers for your AI assistant
            </p>
          </div>

          {/* Cloud Status */}
          {user?.id && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Cloud:</span>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                cloudConfigExists
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
              }`}>
                {cloudConfigExists ? 'Synced' : 'Not Saved'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-3">
          <svg className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
              MCP Configuration with Cloud Storage
            </h3>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Configuration is saved as .mcp.json in Supabase Storage (bucket: {user?.id || 'your-user-id'}).
              The file can be used by Claude Desktop and other MCP-compatible tools.
            </p>
          </div>
        </div>
      </div>

      {/* MCP Servers Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <MCPJsonEditor
          value={mcpServersConfig}
          onChange={(newConfig) => setMcpServersConfig(newConfig)}
          onSave={handleSaveMCPConfig}
          isSaving={isSavingMCP}
        />
      </div>

      {!user?.id && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            Please login to save configuration to cloud storage.
          </p>
        </div>
      )}

      {/* Info Section */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
          About Cloud Storage & Context7 Integration
        </h3>
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            Your configuration is stored in Supabase Object Storage as <code className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">.mcp.json</code> in a private bucket named after your user ID.
            This file can be used by Claude Desktop and other MCP-compatible applications.
          </p>
          <p>
            <strong>Context7 Integration:</strong> Context7 provides up-to-date documentation for any library,
            replacing the previous runbook management system. The Claude agent can now access current documentation
            directly through the Context7 MCP server.
          </p>
          <p>
            <strong>Key Features:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Cloud storage with Supabase Object Storage</li>
            <li>Access to latest library documentation via Context7</li>
            <li>No need to maintain local runbooks</li>
            <li>Automatic updates when libraries are updated</li>
            <li>Support for thousands of popular libraries</li>
            <li>Private bucket per user for secure configuration</li>
          </ul>
        </div>
      </div>

      {/* Skill Upload Modal */}
      <SkillUploadModal
        isOpen={showSkillUploadModal}
        onClose={() => setShowSkillUploadModal(false)}
        onSkillUploaded={handleSkillUploaded}
      />
    </div>
  );
}
