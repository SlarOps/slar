/**
 * Workspace Manager
 * Manages Claude Code compatible workspace structure:
 *
 * Storage Strategy:
 * - MCP Servers: PostgreSQL (user_mcp_servers table) - PRIMARY SOURCE
 *   Use: getMCPServersFromDB(), saveMCPServerToDB(), deleteMCPServerFromDB()
 * - Installed Plugins: PostgreSQL (installed_plugins table) - PRIMARY SOURCE
 *   Use: getInstalledPluginsFromDB(), addInstalledPluginToDB(), removeInstalledPluginFromDB()
 * - Marketplaces: PostgreSQL (marketplaces table) + Git clone in workspace
 *   Use: loadMarketplaceFromDB(), loadAllMarketplacesFromDB()
 * - Skills: Supabase Storage bucket (still uses object storage)
 *
 * Workspace Structure (Supabase Storage bucket):
 * user_id/
 * - .mcp.json                      # Local sync of MCP config (backup only)
 * - .claude/
 *     - skills/                    # Skills directory (bucket storage)
 *         - skill1.skill
 *         - skill2.skill
 *     - plugins/                   # Git-cloned marketplaces
 *         - marketplaces/
 *             - marketplace-name/  # Git repo clone
 */

import { initSupabase } from './supabase';
import apiClient from './api';

const WORKSPACE_PATHS = {
  MCP_CONFIG: '.mcp.json',
  CLAUDE_DIR: '.claude',
  SKILLS_DIR: '.claude/skills',
  PLUGINS_DIR: '.claude/plugins',
  INSTALLED_PLUGINS: '.claude/plugins/installed_plugins.json',
  MARKETPLACES_DIR: '.claude/plugins/marketplaces'
};

/**
 * Initialize workspace structure for user
 */
export async function initializeWorkspace(userId) {
  try {
    const supabase = await initSupabase();

    // Check if bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === userId);

    if (!bucketExists) {
      // Create user bucket
      const { error: createError } = await supabase.storage.createBucket(userId, {
        public: false,
        fileSizeLimit: 50 * 1024 * 1024, // 50MB
        allowedMimeTypes: [
          'application/json',
          'application/octet-stream',
          'application/zip',
          'text/plain',
          'text/markdown'
        ]
      });

      if (createError) {
        throw new Error(`Failed to create bucket: ${createError.message}`);
      }
    }

    // Create initial workspace structure
    await createFile(userId, WORKSPACE_PATHS.MCP_CONFIG, {
      mcpServers: {
        "context7": {
          command: "npx",
          args: ["-y", "@uptudev/mcp-context7"],
          env: {}
        }
      }
    });

    await createFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS, {
      version: 1,
      plugins: {}
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to initialize workspace:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create or update a file in workspace
 */
export async function createFile(userId, path, content) {
  try {
    console.log('[workspaceManager] createFile called:', { userId, path, contentType: typeof content });

    const supabase = await initSupabase();

    const blob = new Blob(
      [typeof content === 'string' ? content : JSON.stringify(content, null, 2)],
      { type: 'application/json' }
    );

    console.log('[workspaceManager] Blob created, size:', blob.size);

    const { data, error } = await supabase.storage
      .from(userId)
      .upload(path, blob, {
        contentType: 'application/json',
        upsert: true
      });

    console.log('[workspaceManager] Upload result:', { data, error });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error(`[workspaceManager] Failed to create file ${path}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Read file from workspace
 */
export async function readFile(userId, path) {
  try {
    const supabase = await initSupabase();

    const { data, error } = await supabase.storage
      .from(userId)
      .download(path);

    if (error) throw error;

    const text = await data.text();
    return { success: true, content: text };
  } catch (error) {
    console.error(`Failed to read file ${path}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete file from workspace
 */
export async function deleteFile(userId, path) {
  try {
    const supabase = await initSupabase();

    const { error } = await supabase.storage
      .from(userId)
      .remove([path]);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error(`Failed to delete file ${path}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * List files in directory
 */
export async function listFiles(userId, directory = '') {
  try {
    const supabase = await initSupabase();

    const { data, error } = await supabase.storage
      .from(userId)
      .list(directory, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) throw error;

    return { success: true, files: data || [] };
  } catch (error) {
    console.error(`Failed to list files in ${directory}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * ============================================================
 * MCP CONFIG MANAGEMENT
 * ============================================================
 */

/**
 * Get MCP configuration
 */
export async function getMCPConfig(userId) {
  try {
    const result = await readFile(userId, WORKSPACE_PATHS.MCP_CONFIG);

    if (!result.success) {
      // Initialize if doesn't exist
      await initializeWorkspace(userId);
      return getMCPConfig(userId);
    }

    return { success: true, config: JSON.parse(result.content) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get MCP servers from PostgreSQL (NEW - instant, no S3 lag!)
 * @param {string} userId - User ID (not used, auth token contains user_id)
 * @returns {Promise<{success: boolean, config: object, error?: string}>}
 */
export async function getMCPServersFromDB(userId) {
  try {
    console.log('[workspaceManager] 📂 Loading MCP servers from PostgreSQL');

    const result = await apiClient.getMCPServers();

    if (!result.success) {
      throw new Error(result.error || 'Failed to get MCP servers');
    }

    // Convert array to object format (for backward compatibility with UI)
    const serversObject = {};
    for (const server of result.servers || []) {
      const { server_name, server_type, command, args, env, url, headers } = server;

      if (server_type === 'stdio') {
        serversObject[server_name] = { command, args, env };
      } else {
        serversObject[server_name] = { type: server_type, url, headers };
      }
    }

    console.log('[workspaceManager] ✅ Loaded', result.servers?.length || 0, 'MCP servers from PostgreSQL');

    return {
      success: true,
      config: {
        mcpServers: serversObject
      }
    };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to get MCP servers from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create or update MCP server in PostgreSQL (NEW - instant, no S3 lag!)
 * @param {string} userId - User ID (not used, auth token contains user_id)
 * @param {string} serverName - Server name
 * @param {object} serverConfig - Server configuration
 * @returns {Promise<{success: boolean, server?: object, error?: string}>}
 */
export async function saveMCPServerToDB(userId, serverName, serverConfig) {
  try {
    console.log('[workspaceManager] 💾 Saving MCP server to PostgreSQL:', { serverName, serverConfig });

    const result = await apiClient.saveMCPServer(serverName, serverConfig);

    if (!result.success) {
      throw new Error(result.error || 'Failed to save MCP server');
    }

    console.log('[workspaceManager] ✅ MCP server saved to PostgreSQL');
    return { success: true, server: result.server };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to save MCP server to DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete MCP server from PostgreSQL (NEW - instant, no S3 lag!)
 * @param {string} userId - User ID (not used, auth token contains user_id)
 * @param {string} serverName - Server name to delete
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function deleteMCPServerFromDB(userId, serverName) {
  try {
    console.log('[workspaceManager] 🗑️ Deleting MCP server from PostgreSQL:', serverName);

    const result = await apiClient.deleteMCPServer(serverName);

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete MCP server');
    }

    console.log('[workspaceManager] ✅ MCP server deleted from PostgreSQL');
    return { success: true, message: result.message };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to delete MCP server from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ============================================================
 * MEMORY (CLAUDE.md) MANAGEMENT
 * ============================================================
 */

/**
 * Get CLAUDE.md content from PostgreSQL (NEW - instant, no S3 lag!)
 * @param {string} userId - User ID (not used, auth token contains user_id)
 * @param {string} scope - Memory scope ('local' or 'user', default: 'local')
 * @returns {Promise<{success: boolean, content: string, updated_at?: string, error?: string}>}
 */
export async function getMemoryFromDB(userId, scope = 'local') {
  try {
    console.log('[workspaceManager] 📂 Loading CLAUDE.md from PostgreSQL');

    const result = await apiClient.getMemory(scope);

    if (!result.success) {
      throw new Error(result.error || 'Failed to get memory');
    }

    console.log('[workspaceManager] ✅ Loaded CLAUDE.md from PostgreSQL');

    return {
      success: true,
      content: result.content || '',
      updated_at: result.updated_at
    };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to get memory from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update CLAUDE.md content in PostgreSQL (NEW - instant, no S3 lag!)
 * @param {string} userId - User ID (not used, auth token contains user_id)
 * @param {string} content - Markdown content for CLAUDE.md
 * @param {string} scope - Memory scope ('local' or 'user', default: 'local')
 * @returns {Promise<{success: boolean, content?: string, updated_at?: string, error?: string}>}
 */
export async function saveMemoryToDB(userId, content, scope = 'local') {
  try {
    console.log('[workspaceManager] 💾 Saving CLAUDE.md to PostgreSQL');

    const result = await apiClient.saveMemory(content, scope);

    if (!result.success) {
      throw new Error(result.error || 'Failed to save memory');
    }

    console.log('[workspaceManager] ✅ CLAUDE.md saved to PostgreSQL');
    return { success: true, content: result.content, updated_at: result.updated_at };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to save memory to DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete CLAUDE.md content from PostgreSQL (NEW - instant, no S3 lag!)
 * @param {string} userId - User ID (not used, auth token contains user_id)
 * @param {string} scope - Memory scope ('local' or 'user', default: 'local')
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function deleteMemoryFromDB(userId, scope = 'local') {
  try {
    console.log('[workspaceManager] 🗑️ Deleting CLAUDE.md from PostgreSQL');

    const result = await apiClient.deleteMemory(scope);

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete memory');
    }

    console.log('[workspaceManager] ✅ CLAUDE.md deleted from PostgreSQL');
    return { success: true, message: result.message };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to delete memory from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ============================================================
 * SKILLS MANAGEMENT
 * ============================================================
 */

/**
 * Upload skill file to workspace
 */
export async function uploadSkill(userId, skillFile, skillName) {
  try {
    const supabase = await initSupabase();

    const fileName = skillName || skillFile.name;
    const skillPath = `${WORKSPACE_PATHS.SKILLS_DIR}/${fileName}`;

    const { error } = await supabase.storage
      .from(userId)
      .upload(skillPath, skillFile, {
        contentType: skillFile.type || 'application/octet-stream',
        upsert: true
      });

    if (error) throw error;

    return { success: true, path: skillPath };
  } catch (error) {
    console.error('Failed to upload skill:', error);
    return { success: false, error: error.message };
  }
}

/**
 * List all skills in workspace
 */
export async function listSkills(userId) {
  try {
    const result = await listFiles(userId, WORKSPACE_PATHS.SKILLS_DIR);

    if (!result.success) return result;

    const skills = result.files.filter(file =>
      file.name.endsWith('.skill') || file.name.endsWith('.md')
    );

    return { success: true, skills };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete skill from workspace
 */
export async function deleteSkill(userId, skillName) {
  const skillPath = `${WORKSPACE_PATHS.SKILLS_DIR}/${skillName}`;
  return await deleteFile(userId, skillPath);
}

/**
 * ============================================================
 * INSTALLED PLUGINS MANAGEMENT
 * ============================================================
 */

/**
 * Get installed plugins from PostgreSQL database (NEW - instant!)
 * @param {string} userId - User ID
 * @param {string} authToken - Auth token for API authentication
 * @returns {Promise<{success: boolean, plugins: Array}>}
 */
export async function getInstalledPluginsFromDB(userId, authToken) {
  try {
    console.log('[workspaceManager] 📂 Loading installed plugins from AI API:', userId);

    // Set auth token before API call
    if (authToken) {
      apiClient.setToken(authToken);
    }

    // Use AI API endpoint instead of direct Supabase call
    const result = await apiClient.getInstalledPlugins();

    if (!result.success) {
      console.error('[workspaceManager] ❌ Error loading plugins from API:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[workspaceManager] ✅ Loaded', result.plugins?.length || 0, 'plugins from AI API');

    return { success: true, plugins: result.plugins || [] };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to load plugins from API:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add plugin to PostgreSQL database (NEW - instant!)
 * @param {string} userId - User ID
 * @param {object} plugin - Plugin data
 * @param {string} authToken - Auth token for API authentication
 */
export async function addInstalledPluginToDB(userId, plugin, authToken) {
  try {
    console.log('[workspaceManager] 💾 Adding plugin via AI API:', { userId, plugin });

    // Set auth token before API call
    if (authToken) {
      apiClient.setToken(authToken);
    }

    // Use AI API endpoint instead of direct Supabase call
    const result = await apiClient.addInstalledPlugin({
      plugin_name: plugin.name,
      marketplace_name: plugin.marketplaceName,
      plugin_type: plugin.type || 'skill',
      config: {
        marketplace_id: plugin.marketplaceId || null,
        version: plugin.version || 'unknown',
        install_path: plugin.installPath || `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${plugin.marketplaceName}/${plugin.name}`,
        status: plugin.status || 'active',
        is_local: plugin.isLocal || false,
        git_commit_sha: plugin.gitCommitSha || null
      }
    });

    if (!result.success) {
      console.error('[workspaceManager] ❌ Error adding plugin via API:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[workspaceManager] ✅ Plugin added via AI API');
    return { success: true, plugin: result.plugin };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to add plugin via API:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove plugin from PostgreSQL database (NEW - instant!)
 * @param {string} userId - User ID
 * @param {string} pluginId - Plugin UUID
 * @param {string} authToken - Auth token for API authentication
 */
export async function removeInstalledPluginFromDB(userId, pluginId, authToken) {
  try {
    console.log('[workspaceManager] 🗑️ Removing plugin via AI API:', { userId, pluginId });

    // Set auth token before API call
    if (authToken) {
      apiClient.setToken(authToken);
    }

    // Use AI API endpoint instead of direct Supabase call
    const result = await apiClient.removeInstalledPlugin(pluginId);

    if (!result.success) {
      console.error('[workspaceManager] ❌ Error removing plugin via API:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[workspaceManager] ✅ Plugin removed via AI API');
    return { success: true };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to remove plugin via API:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Load marketplace from PostgreSQL database (instant, no lag!)
 * @param {string} userId - User ID
 * @param {string} marketplaceName - Marketplace name
 * @param {string} authToken - Auth token for API authentication
 */
export async function loadMarketplaceFromDB(userId, marketplaceName, authToken) {
  try {
    console.log('[workspaceManager] 📂 Loading marketplace from AI API:', { userId, marketplaceName });

    // Set auth token before API call
    if (authToken) {
      apiClient.setToken(authToken);
    }

    // Use AI API endpoint instead of direct Supabase call
    const result = await apiClient.getMarketplaceByName(marketplaceName);

    if (!result.success) {
      console.error('[workspaceManager] ❌ Error loading marketplace from API:', result.error);
      return { success: false, error: result.error };
    }

    if (!result.marketplace) {
      console.log('[workspaceManager] ❌ Marketplace not found');
      return { success: false, error: 'Marketplace not found' };
    }

    console.log('[workspaceManager] ✅ Loaded marketplace from AI API:', result.marketplace.name);
    console.log('[workspaceManager]    Plugins:', result.marketplace.plugins?.length || 0);

    return { success: true, marketplace: result.marketplace };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to load marketplace from API:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Load ALL marketplaces from PostgreSQL database (NEW - instant, no lag!)
 * @param {string} userId - User ID
 * @param {string} authToken - Auth token for API authentication
 */
export async function loadAllMarketplacesFromDB(userId, authToken) {
  try {
    console.log('[workspaceManager] 📂 Loading all marketplaces from AI API:', { userId });

    // Set auth token before API call
    if (authToken) {
      apiClient.setToken(authToken);
    }

    // Use AI API endpoint instead of direct Supabase call
    const result = await apiClient.getAllMarketplaces();

    if (!result.success) {
      console.error('[workspaceManager] ❌ Error loading marketplaces from API:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[workspaceManager] ✅ Loaded', result.marketplaces?.length || 0, 'marketplaces from AI API');

    return { success: true, marketplaces: result.marketplaces || [] };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to load marketplaces from API:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ============================================================
 * WORKSPACE SYNC
 * ============================================================
 */

/**
 * Sync workspace to AI agent backend
 */
export async function syncWorkspace(userId, authToken) {
  try {
    const result = await apiClient.syncWorkspace(userId);
    return result;
  } catch (error) {
    console.error('Failed to sync workspace:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get workspace structure info
 */
export async function getWorkspaceInfo(userId) {
  try {
    // Get MCP config
    const mcpResult = await getMCPConfig(userId);

    // Get skills
    const skillsResult = await listSkills(userId);

    // Get installed plugins
    const pluginsResult = await getInstalledPlugins(userId);

    return {
      success: true,
      workspace: {
        mcp: mcpResult.success ? mcpResult.config : null,
        skills: skillsResult.success ? skillsResult.skills : [],
        plugins: pluginsResult.success ? pluginsResult.plugins : []
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete marketplace asynchronously via PGMQ
 *
 * This function calls the AI service DELETE endpoint which:
 * 1. Marks marketplace as "deleting" in PostgreSQL
 * 2. Enqueues cleanup task to PGMQ
 * 3. Returns immediately (background worker handles actual cleanup)
 *
 * Background worker will:
 * - Delete workspace directory
 * - Delete ZIP files from S3
 * - Delete installed plugins
 * - Delete marketplace metadata
 *
 * @param {string} marketplaceName - Name of marketplace to delete
 * @param {string} authToken - Bearer token for authentication
 * @returns {Promise<Object>} - {success: bool, message: str, job_id: number}
 */
export async function deleteMarketplaceAsync(marketplaceName, authToken) {
  try {
    console.log(`[deleteMarketplaceAsync] Deleting marketplace: ${marketplaceName}`);

    const result = await apiClient.deleteMarketplace(marketplaceName);

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete marketplace');
    }

    console.log(`[deleteMarketplaceAsync] ✅ Marketplace deletion initiated (job_id: ${result.job_id})`);

    return {
      success: true,
      message: result.message,
      job_id: result.job_id,
      status: result.status
    };
  } catch (error) {
    console.error('[deleteMarketplaceAsync] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
