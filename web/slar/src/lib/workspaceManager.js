/**
 * Workspace Manager
 * Manages Claude Code compatible workspace structure:
 *
 * user_id/
 * - .mcp.json                      # MCP server configurations
 * - .claude/
 *     - skills/                    # Skills directory
 *         - skill1.skill
 *         - skill2.skill
 *     - plugins/                   # Plugins directory
 *         - installed_plugins.json # Installed plugins metadata
 *         - marketplaces/          # Downloaded plugin contents
 *             - plugin1/
 *             - plugin2/
 */

import { initSupabase } from './supabase';

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
 * Update MCP configuration (LEGACY - uses S3 JSON file with lag)
 * @deprecated Use saveMCPServerToDB() instead
 */
export async function updateMCPConfig(userId, mcpServers) {
  try {
    const config = {
      mcpServers,
      metadata: {
        version: "1.0.0",
        updatedAt: new Date().toISOString()
      }
    };

    return await createFile(userId, WORKSPACE_PATHS.MCP_CONFIG, config);
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

    const supabase = await initSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(
      `${agentApiUrl}/api/mcp-servers?auth_token=${encodeURIComponent('Bearer ' + session.access_token)}`,
      { method: 'GET' }
    );

    const result = await response.json();

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

    const supabase = await initSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const requestBody = {
      auth_token: 'Bearer ' + session.access_token,
      server_name: serverName,
      ...serverConfig
    };

    const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(
      `${agentApiUrl}/api/mcp-servers`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    const result = await response.json();

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

    const supabase = await initSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(
      `${agentApiUrl}/api/mcp-servers/${encodeURIComponent(serverName)}?auth_token=${encodeURIComponent('Bearer ' + session.access_token)}`,
      { method: 'DELETE' }
    );

    const result = await response.json();

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
 * @returns {Promise<{success: boolean, content: string, updated_at?: string, error?: string}>}
 */
export async function getMemoryFromDB(userId) {
  try {
    console.log('[workspaceManager] 📂 Loading CLAUDE.md from PostgreSQL');

    const supabase = await initSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(
      `${agentApiUrl}/api/memory?auth_token=${encodeURIComponent('Bearer ' + session.access_token)}`,
      { method: 'GET' }
    );

    const result = await response.json();

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
 * @returns {Promise<{success: boolean, content?: string, updated_at?: string, error?: string}>}
 */
export async function saveMemoryToDB(userId, content) {
  try {
    console.log('[workspaceManager] 💾 Saving CLAUDE.md to PostgreSQL');

    const supabase = await initSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const requestBody = {
      auth_token: 'Bearer ' + session.access_token,
      content
    };

    const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(
      `${agentApiUrl}/api/memory`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    const result = await response.json();

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
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function deleteMemoryFromDB(userId) {
  try {
    console.log('[workspaceManager] 🗑️ Deleting CLAUDE.md from PostgreSQL');

    const supabase = await initSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(
      `${agentApiUrl}/api/memory?auth_token=${encodeURIComponent('Bearer ' + session.access_token)}`,
      { method: 'DELETE' }
    );

    const result = await response.json();

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
 * @returns {Promise<{success: boolean, plugins: Array}>}
 */
export async function getInstalledPluginsFromDB(userId) {
  try {
    console.log('[workspaceManager] 📂 Loading installed plugins from PostgreSQL:', userId);

    const supabase = await initSupabase();

    const { data, error } = await supabase
      .from('installed_plugins')
      .select('*')
      .eq('user_id', userId)
      .order('installed_at', { ascending: false });

    if (error) {
      console.error('[workspaceManager] ❌ Error loading plugins from DB:', error);
      return { success: false, error: error.message };
    }

    console.log('[workspaceManager] ✅ Loaded', data?.length || 0, 'plugins from PostgreSQL');

    return { success: true, plugins: data || [] };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to load plugins from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add plugin to PostgreSQL database (NEW - instant!)
 * @param {string} userId - User ID
 * @param {object} plugin - Plugin data
 */
export async function addInstalledPluginToDB(userId, plugin) {
  try {
    console.log('[workspaceManager] 💾 Adding plugin to PostgreSQL:', { userId, plugin });

    const supabase = await initSupabase();

    const pluginRecord = {
      user_id: userId,
      plugin_name: plugin.name,
      marketplace_name: plugin.marketplaceName,
      marketplace_id: plugin.marketplaceId || null,
      version: plugin.version || 'unknown',
      install_path: plugin.installPath || `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${plugin.marketplaceName}/${plugin.name}`,
      status: plugin.status || 'active',
      is_local: plugin.isLocal || false,
      git_commit_sha: plugin.gitCommitSha || null
    };

    const { data, error } = await supabase
      .from('installed_plugins')
      .upsert(pluginRecord, {
        onConflict: 'user_id,plugin_name,marketplace_name'
      })
      .select()
      .single();

    if (error) {
      console.error('[workspaceManager] ❌ Error adding plugin to DB:', error);
      return { success: false, error: error.message };
    }

    console.log('[workspaceManager] ✅ Plugin added to PostgreSQL');
    return { success: true, plugin: data };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to add plugin to DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove plugin from PostgreSQL database (NEW - instant!)
 * @param {string} userId - User ID
 * @param {string} pluginId - Plugin UUID
 */
export async function removeInstalledPluginFromDB(userId, pluginId) {
  try {
    console.log('[workspaceManager] 🗑️ Removing plugin from PostgreSQL:', { userId, pluginId });

    const supabase = await initSupabase();

    const { error } = await supabase
      .from('installed_plugins')
      .delete()
      .eq('id', pluginId)
      .eq('user_id', userId);

    if (error) {
      console.error('[workspaceManager] ❌ Error removing plugin from DB:', error);
      return { success: false, error: error.message };
    }

    console.log('[workspaceManager] ✅ Plugin removed from PostgreSQL');
    return { success: true };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to remove plugin from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get installed plugins metadata (LEGACY - uses S3 JSON file with lag)
 * @deprecated Use getInstalledPluginsFromDB() instead
 * Returns plugins as object with keys like "pluginName@marketplaceName"
 */
export async function getInstalledPlugins(userId) {
  try {
    console.log('[workspaceManager] getInstalledPlugins called for userId (LEGACY):', userId);
    const result = await readFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS);
    console.log('[workspaceManager] Read result:', { success: result.success, contentLength: result.content?.length });

    if (!result.success) {
      // Initialize if doesn't exist
      console.log('[workspaceManager] File does not exist, initializing...');
      const initResult = await createFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS, {
        version: 1,
        plugins: {}
      });
      console.log('[workspaceManager] Init result:', initResult);
      return { success: true, plugins: {} };
    }

    // Check if content is empty
    if (!result.content || result.content.trim() === '') {
      console.log('[workspaceManager] File is empty, reinitializing...');
      await createFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS, {
        version: 1,
        plugins: {}
      });
      return { success: true, plugins: {} };
    }

    const data = JSON.parse(result.content);
    console.log('[workspaceManager] Parsed data:', data);

    // Ensure plugins is an object, not an array
    let plugins = data.plugins || {};
    if (Array.isArray(plugins)) {
      console.warn('[workspaceManager] plugins is an array, converting to object');
      plugins = {};
    }

    return { success: true, plugins };
  } catch (error) {
    console.error('[workspaceManager] Error in getInstalledPlugins:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add plugin to installed list
 * @param {string} userId - User ID
 * @param {object} plugin - Plugin data with: name, marketplaceName, version, installPath, etc.
 * Format: { name, marketplaceName, version, installPath, gitCommitSha?, isLocal }
 */
export async function addInstalledPlugin(userId, plugin) {
  try {
    console.log('[workspaceManager] addInstalledPlugin called:', { userId, plugin });

    const result = await getInstalledPlugins(userId);
    console.log('[workspaceManager] Current installed plugins:', result);
    console.log('[workspaceManager] Type check - plugins is:', typeof result.plugins, 'isArray:', Array.isArray(result.plugins));

    if (!result.success) throw new Error(result.error);

    // Ensure plugins is an object
    let plugins = result.plugins;
    if (Array.isArray(plugins)) {
      console.warn('[workspaceManager] Converting array to object');
      plugins = {};
    } else if (typeof plugins !== 'object' || plugins === null) {
      console.warn('[workspaceManager] Invalid plugins type, resetting to empty object');
      plugins = {};
    }

    console.log('[workspaceManager] Using plugins object:', plugins);

    // Create key: pluginName@marketplaceName
    const pluginKey = `${plugin.name}@${plugin.marketplaceName}`;
    console.log('[workspaceManager] Plugin key:', pluginKey);

    const now = new Date().toISOString();

    // Check if already installed
    if (plugins[pluginKey]) {
      console.log('[workspaceManager] Updating existing plugin');
      // Update existing
      plugins[pluginKey] = {
        ...plugins[pluginKey],
        version: plugin.version || plugins[pluginKey].version,
        lastUpdated: now,
        installPath: plugin.installPath || plugins[pluginKey].installPath,
        gitCommitSha: plugin.gitCommitSha || plugins[pluginKey].gitCommitSha,
        isLocal: plugin.isLocal !== undefined ? plugin.isLocal : plugins[pluginKey].isLocal
      };
    } else {
      console.log('[workspaceManager] Adding new plugin');
      // Add new
      plugins[pluginKey] = {
        version: plugin.version || 'unknown',
        installedAt: now,
        lastUpdated: now,
        installPath: plugin.installPath || `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${plugin.marketplaceName}/${plugin.name}`,
        ...(plugin.gitCommitSha && { gitCommitSha: plugin.gitCommitSha }),
        isLocal: plugin.isLocal !== undefined ? plugin.isLocal : false
      };
    }

    const data = {
      version: 1,
      plugins
    };

    console.log('[workspaceManager] Writing data to file:', data);
    const writeResult = await createFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS, data);
    console.log('[workspaceManager] Write result:', writeResult);

    return writeResult;
  } catch (error) {
    console.error('[workspaceManager] Error in addInstalledPlugin:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove plugin from installed list
 * @param {string} userId - User ID
 * @param {string} pluginKey - Plugin key in format "pluginName@marketplaceName"
 */
export async function removeInstalledPlugin(userId, pluginKey) {
  try {
    const result = await getInstalledPlugins(userId);

    if (!result.success) throw new Error(result.error);

    const plugins = { ...result.plugins };
    delete plugins[pluginKey];

    const data = {
      version: 1,
      plugins
    };

    return await createFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS, data);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update plugin metadata
 * @param {string} userId - User ID
 * @param {string} pluginKey - Plugin key in format "pluginName@marketplaceName"
 * @param {object} updates - Fields to update
 */
export async function updatePluginMetadata(userId, pluginKey, updates) {
  try {
    const result = await getInstalledPlugins(userId);

    if (!result.success) throw new Error(result.error);

    const plugins = { ...result.plugins };

    if (!plugins[pluginKey]) {
      throw new Error(`Plugin ${pluginKey} not found`);
    }

    plugins[pluginKey] = {
      ...plugins[pluginKey],
      ...updates,
      lastUpdated: new Date().toISOString()
    };

    const data = {
      version: 1,
      plugins
    };

    return await createFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS, data);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * ============================================================
 * PLUGIN MARKETPLACE FILES
 * ============================================================
 */

/**
 * Save plugin files to marketplace directory
 */
export async function savePluginFiles(userId, pluginId, files) {
  try {
    console.log('[workspaceManager] savePluginFiles called:', { userId, pluginId, fileCount: Object.keys(files).length });

    const supabase = await initSupabase();
    const pluginDir = `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${pluginId}`;

    // Save each file
    for (const [fileName, content] of Object.entries(files)) {
      const filePath = `${pluginDir}/${fileName}`;
      console.log('[workspaceManager] Saving file:', filePath);

      const blob = new Blob([content], {
        type: fileName.endsWith('.json') ? 'application/json' : 'text/plain'
      });

      const { error } = await supabase.storage
        .from(userId)
        .upload(filePath, blob, {
          contentType: blob.type,
          upsert: true
        });

      if (error) {
        console.error(`[workspaceManager] Failed to save ${fileName}:`, error);
      } else {
        console.log(`[workspaceManager] Successfully saved ${fileName}`);
      }
    }

    console.log('[workspaceManager] All files saved, returning path:', pluginDir);
    return { success: true, path: pluginDir };
  } catch (error) {
    console.error('[workspaceManager] Failed to save plugin files:', error);
    return { success: false, error: error.message };
  }
}

/**
 * List plugin files
 */
export async function listPluginFiles(userId, pluginId) {
  const pluginDir = `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${pluginId}`;
  return await listFiles(userId, pluginDir);
}

/**
 * Delete plugin files
 */
export async function deletePluginFiles(userId, pluginId) {
  try {
    const result = await listPluginFiles(userId, pluginId);

    if (!result.success) return result;

    const supabase = await initSupabase();
    const pluginDir = `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${pluginId}`;

    // Delete all files in plugin directory
    const filePaths = result.files.map(file => `${pluginDir}/${file.name}`);

    const { error } = await supabase.storage
      .from(userId)
      .remove(filePaths);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Reset installed_plugins.json to correct format
 */
export async function resetInstalledPlugins(userId) {
  try {
    console.log('[workspaceManager] Resetting installed_plugins.json to correct format');

    const data = {
      version: 1,
      plugins: {}
    };

    const result = await createFile(userId, WORKSPACE_PATHS.INSTALLED_PLUGINS, data);
    console.log('[workspaceManager] Reset result:', result);

    return result;
  } catch (error) {
    console.error('[workspaceManager] Failed to reset installed plugins:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save entire marketplace to storage
 * @param {string} userId - User ID
 * @param {string} marketplaceName - Marketplace name
 * @param {object} marketplaceJson - marketplace.json content
 * @param {object} skills - Object with skill paths as keys and files as values
 * Example: { "plugin1/skill1": { "SKILL.md": "...", "file.py": "..." } }
 */
export async function saveMarketplace(userId, marketplaceName, allFiles) {
  try {
    console.log('[workspaceManager] Saving entire marketplace (clone):', {
      userId,
      marketplaceName,
      fileCount: Object.keys(allFiles).length
    });

    const supabase = await initSupabase();
    const marketplaceDir = `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${marketplaceName}`;

    let savedCount = 0;
    let failedCount = 0;

    // Save all files with their original paths from repo
    for (const [filePath, content] of Object.entries(allFiles)) {
      try {
        // Full path in bucket: .claude/plugins/marketplaces/{marketplaceName}/{original-repo-path}
        const fullPath = `${marketplaceDir}/${filePath}`;
        console.log(`[workspaceManager] Saving: ${fullPath}`);

        // Determine content type from file extension
        let contentType = 'text/plain';
        if (filePath.endsWith('.json')) {
          contentType = 'application/json';
        } else if (filePath.endsWith('.md')) {
          contentType = 'text/markdown';
        } else if (filePath.endsWith('.js')) {
          contentType = 'application/javascript';
        } else if (filePath.endsWith('.py')) {
          contentType = 'text/x-python';
        }

        const blob = new Blob([content], { type: contentType });

        const { error } = await supabase.storage
          .from(userId)
          .upload(fullPath, blob, {
            contentType,
            upsert: true
          });

        if (error) {
          console.error(`[workspaceManager] Failed to save ${fullPath}:`, error);
          failedCount++;
        } else {
          savedCount++;
        }
      } catch (error) {
        console.error(`[workspaceManager] Error saving file ${filePath}:`, error);
        failedCount++;
      }
    }

    console.log(`[workspaceManager] Marketplace saved: ${savedCount}/${Object.keys(allFiles).length} files`);

    return {
      success: failedCount === 0,
      savedCount,
      failedCount,
      path: marketplaceDir
    };
  } catch (error) {
    console.error('[workspaceManager] Failed to save marketplace:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Load marketplace from PostgreSQL database (NEW - instant, no lag!)
 * @param {string} userId - User ID
 * @param {string} marketplaceName - Marketplace name
 */
export async function loadMarketplaceFromDB(userId, marketplaceName) {
  try {
    console.log('[workspaceManager] 📂 Loading marketplace from PostgreSQL:', { userId, marketplaceName });

    const supabase = await initSupabase();

    const { data, error } = await supabase
      .from('marketplaces')
      .select('*')
      .eq('user_id', userId)
      .eq('name', marketplaceName)
      .single();

    if (error) {
      console.error('[workspaceManager] ❌ Error loading marketplace from DB:', error);
      return { success: false, error: error.message };
    }

    if (!data) {
      console.log('[workspaceManager] ❌ Marketplace not found in database');
      return { success: false, error: 'Marketplace not found' };
    }

    console.log('[workspaceManager] ✅ Loaded marketplace from PostgreSQL:', data.name);
    console.log('[workspaceManager]    Plugins:', data.plugins?.length || 0);

    return { success: true, marketplace: data };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to load marketplace from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Load ALL marketplaces from PostgreSQL database (NEW - instant, no lag!)
 * @param {string} userId - User ID
 */
export async function loadAllMarketplacesFromDB(userId) {
  try {
    console.log('[workspaceManager] 📂 Loading all marketplaces from PostgreSQL:', { userId });

    const supabase = await initSupabase();

    const { data, error } = await supabase
      .from('marketplaces')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[workspaceManager] ❌ Error loading marketplaces from DB:', error);
      return { success: false, error: error.message };
    }

    console.log('[workspaceManager] ✅ Loaded', data?.length || 0, 'marketplaces from PostgreSQL');

    return { success: true, marketplaces: data || [] };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to load marketplaces from DB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Load marketplace.json from bucket (LEGACY - has 10-15s lag!)
 * @deprecated Use loadMarketplaceFromDB() instead
 * @param {string} userId - User ID
 * @param {string} marketplaceName - Marketplace name
 */
export async function loadMarketplaceFromBucket(userId, marketplaceName) {
  try {
    console.log('[workspaceManager] 📂 Loading marketplace from bucket (LEGACY):', { userId, marketplaceName });

    const marketplaceJsonPath = `${WORKSPACE_PATHS.MARKETPLACES_DIR}/${marketplaceName}/.claude-plugin/marketplace.json`;
    console.log('[workspaceManager]    Path:', marketplaceJsonPath);

    const result = await readFile(userId, marketplaceJsonPath);
    console.log('[workspaceManager]    readFile result:', { success: result.success, error: result.error });

    if (!result.success) {
      console.log('[workspaceManager] ❌ Marketplace not found in bucket');
      console.log('[workspaceManager]    Error:', result.error);
      return { success: false, error: `Marketplace not found in bucket: ${result.error}` };
    }

    if (!result.content || result.content.trim() === '') {
      console.log('[workspaceManager] ❌ Marketplace file is empty');
      return { success: false, error: 'Marketplace file is empty' };
    }

    let marketplaceJson;
    try {
      marketplaceJson = JSON.parse(result.content);
    } catch (parseError) {
      console.error('[workspaceManager] ❌ Failed to parse marketplace JSON:', parseError);
      return { success: false, error: `Invalid JSON in marketplace file: ${parseError.message}` };
    }

    console.log('[workspaceManager] ✅ Loaded marketplace from bucket:', marketplaceJson.name);
    console.log('[workspaceManager]    Plugins:', marketplaceJson.plugins?.length || 0);

    return { success: true, marketplace: marketplaceJson };
  } catch (error) {
    console.error('[workspaceManager] ❌ Failed to load marketplace from bucket:', error);
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
    const agentApiUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';

    const response = await fetch(`${agentApiUrl}/api/sync-workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ user_id: userId })
    });

    const result = await response.json();
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
    const AI_BASE_URL = process.env.NEXT_PUBLIC_AI_BASE_URL || 'http://localhost:8002';

    console.log(`[deleteMarketplaceAsync] Deleting marketplace: ${marketplaceName}`);

    const response = await fetch(
      `${AI_BASE_URL}/api/marketplace/${encodeURIComponent(marketplaceName)}?auth_token=${encodeURIComponent(authToken)}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    if (!data.success) {
      throw new Error(data.error || 'Failed to delete marketplace');
    }

    console.log(`[deleteMarketplaceAsync] ✅ Marketplace deletion initiated (job_id: ${data.job_id})`);

    return {
      success: true,
      message: data.message,
      job_id: data.job_id,
      status: data.status
    };
  } catch (error) {
    console.error('[deleteMarketplaceAsync] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
