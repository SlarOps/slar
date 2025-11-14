import { initSupabase } from './supabase';

/**
 * MCP Storage Helper Functions
 * Manages .mcp.json files in Supabase Storage with userid as bucket name
 */

const MCP_FILE_NAME = '.mcp.json';

/**
 * Generate MCP JSON content from config
 */
export const generateMCPJson = (config, userId) => {
  const mcpConfig = {
    mcpServers: {
      "context7": {
        command: "npx",
        args: ["-y", "@uptudev/mcp-context7"],
        env: {}
      },
      "slar-incident-tools": {
        command: "python",
        args: [
          "/path/to/slar/api/ai/claude_agent_api_v1.py"
        ],
        env: {
          OPENAI_API_KEY: "your-openai-api-key",
          PORT: "8002"
        }
      }
    },
    agentConfig: {
      model: config.model || 'sonnet',
      permissionMode: config.permissionMode || 'default',
      maxTokens: config.maxTokens || 4096,
      enableMCP: config.enableMCP !== undefined ? config.enableMCP : true,
      autoApproveReadOnly: config.autoApproveReadOnly !== undefined ? config.autoApproveReadOnly : true,
      denyDestructive: config.denyDestructive !== undefined ? config.denyDestructive : true,
      userId: userId
    },
    metadata: {
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  return mcpConfig;
};

/**
 * Upload MCP config to Supabase Storage
 * @param {string} userId - User ID (used as bucket name)
 * @param {object} config - MCP configuration object
 * @returns {Promise<{success: boolean, error?: string, data?: any, path?: string}>}
 */
export const uploadMCPConfig = async (userId, config) => {
  try {
    const supabase = await initSupabase();

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID' };
    }

    // Generate MCP JSON
    const mcpJson = generateMCPJson(config, userId);
    const content = JSON.stringify(mcpJson, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    // Validate file size (1MB limit)
    if (blob.size > 1048576) {
      return {
        success: false,
        error: `File size ${(blob.size / 1024).toFixed(2)}KB exceeds 1MB limit`
      };
    }

    // Create bucket if not exists (bucket name is userId)
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      console.error('Error listing buckets:', listError);
      return {
        success: false,
        error: `Failed to list buckets: ${listError.message}`
      };
    }

    const bucketExists = buckets?.some(b => b.name === userId);

    if (!bucketExists) {
      console.log(`Creating private bucket for user: ${userId}`);

      // Create private bucket with user's ID
      // Support both MCP configs (.json) and skills (.skill, .zip)
      const { error: createError } = await supabase.storage.createBucket(userId, {
        public: false,
        fileSizeLimit: 8 * 1024 * 1024, // 8MB (for skill files)
        allowedMimeTypes: [
          'application/json',           // .mcp.json files
          'application/octet-stream',   // .skill files
          'application/zip',            // .zip archives
          'text/plain'                  // text-based skills
        ]
      });

      if (createError) {
        console.error('Error creating bucket:', createError);
        return {
          success: false,
          error: `Failed to create bucket: ${createError.message}`
        };
      }

      console.log(`✅ Bucket created: ${userId}`);
    }

    // Upload or update file with proper options
    const { data, error } = await supabase.storage
      .from(userId)
      .upload(MCP_FILE_NAME, blob, {
        contentType: 'application/json',
        cacheControl: '3600', // Cache for 1 hour
        upsert: true // Overwrite if exists
      });

    if (error) {
      console.error('Error uploading file:', error);
      return {
        success: false,
        error: `Upload failed: ${error.message}`
      };
    }

    console.log(`✅ MCP config uploaded: ${userId}/${MCP_FILE_NAME}`);

    return {
      success: true,
      data,
      path: data?.path || MCP_FILE_NAME
    };
  } catch (error) {
    console.error('Unexpected error in uploadMCPConfig:', error);
    return {
      success: false,
      error: `Unexpected error: ${error.message}`
    };
  }
};

/**
 * Download MCP config from Supabase Storage
 * @param {string} userId - User ID (bucket name)
 * @returns {Promise<{success: boolean, error?: string, config?: object}>}
 */
export const downloadMCPConfig = async (userId) => {
  try {
    const supabase = await initSupabase();

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID' };
    }

    console.log(`Downloading MCP config from: ${userId}/${MCP_FILE_NAME}`);

    // Download file
    const { data, error } = await supabase.storage
      .from(userId)
      .download(MCP_FILE_NAME);

    if (error) {
      console.error('Error downloading file:', error);

      // Provide more specific error messages
      if (error.message.includes('not found') || error.message.includes('does not exist')) {
        return {
          success: false,
          error: 'Configuration file not found. Please save a configuration first.'
        };
      }

      return {
        success: false,
        error: `Download failed: ${error.message}`
      };
    }

    // Validate that we got data
    if (!data) {
      return {
        success: false,
        error: 'No data returned from storage'
      };
    }

    // Parse JSON with error handling
    try {
      const text = await data.text();

      if (!text || text.trim() === '') {
        return {
          success: false,
          error: 'Configuration file is empty'
        };
      }

      const config = JSON.parse(text);

      // Validate config structure
      if (!config || typeof config !== 'object') {
        return {
          success: false,
          error: 'Invalid configuration format'
        };
      }

      console.log(`✅ MCP config downloaded: ${userId}/${MCP_FILE_NAME}`);
      return { success: true, config };

    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      return {
        success: false,
        error: `Invalid JSON format: ${parseError.message}`
      };
    }
  } catch (error) {
    console.error('Unexpected error in downloadMCPConfig:', error);
    return {
      success: false,
      error: `Unexpected error: ${error.message}`
    };
  }
};

/**
 * Get public URL for MCP config file
 * @param {string} userId - User ID (bucket name)
 * @returns {Promise<{success: boolean, error?: string, url?: string}>}
 */
export const getMCPConfigUrl = async (userId) => {
  try {
    const supabase = await initSupabase();

    const { data, error } = await supabase.storage
      .from(userId)
      .createSignedUrl(MCP_FILE_NAME, 3600); // Valid for 1 hour

    if (error) {
      console.error('Error getting signed URL:', error);
      return { success: false, error: error.message };
    }

    return { success: true, url: data.signedUrl };
  } catch (error) {
    console.error('Unexpected error in getMCPConfigUrl:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete MCP config from Supabase Storage
 * @param {string} userId - User ID (bucket name)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteMCPConfig = async (userId) => {
  try {
    const supabase = await initSupabase();

    const { error } = await supabase.storage
      .from(userId)
      .remove([MCP_FILE_NAME]);

    if (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteMCPConfig:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Check if MCP config exists
 * @param {string} userId - User ID (bucket name)
 * @returns {Promise<{exists: boolean, error?: string}>}
 */
export const checkMCPConfigExists = async (userId) => {
  try {
    const supabase = await initSupabase();

    const { data, error } = await supabase.storage
      .from(userId)
      .list('', {
        limit: 100,
        offset: 0,
      });

    if (error) {
      // If bucket doesn't exist, file doesn't exist
      if (error.message.includes('not found') || error.message.includes('does not exist')) {
        return { exists: false };
      }
      console.error('Error checking file existence:', error);
      return { exists: false, error: error.message };
    }

    const exists = data?.some(file => file.name === MCP_FILE_NAME);
    return { exists };
  } catch (error) {
    console.error('Unexpected error in checkMCPConfigExists:', error);
    return { exists: false, error: error.message };
  }
};

/**
 * Upload only MCP servers configuration to Supabase Storage
 * @param {string} userId - User ID (used as bucket name)
 * @param {object} mcpServersConfig - MCP servers configuration object
 * @returns {Promise<{success: boolean, error?: string, data?: any, path?: string}>}
 */
export const uploadMCPServersConfig = async (userId, mcpServersConfig) => {
  try {
    const supabase = await initSupabase();

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID' };
    }

    // Validate mcpServersConfig
    const servers = mcpServersConfig.mcpServers || mcpServersConfig;
    if (!servers || typeof servers !== 'object') {
      return {
        success: false,
        error: 'Invalid MCP servers configuration'
      };
    }

    // Create full MCP JSON structure
    const mcpJson = {
      mcpServers: servers,
      metadata: {
        version: "1.0.0",
        updatedAt: new Date().toISOString()
      }
    };

    const content = JSON.stringify(mcpJson, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    // Validate file size (1MB limit)
    if (blob.size > 1048576) {
      return {
        success: false,
        error: `File size ${(blob.size / 1024).toFixed(2)}KB exceeds 1MB limit`
      };
    }

    // Create bucket if not exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      console.error('Error listing buckets:', listError);
      return {
        success: false,
        error: `Failed to list buckets: ${listError.message}`
      };
    }

    const bucketExists = buckets?.some(b => b.name === userId);

    if (!bucketExists) {
      console.log(`Creating private bucket for user: ${userId}`);

      // Create private bucket supporting both MCP configs and skills
      const { error: createError } = await supabase.storage.createBucket(userId, {
        public: false,
        fileSizeLimit: 8 * 1024 * 1024, // 8MB (for skill files)
        allowedMimeTypes: [
          'application/json',           // .mcp.json files
          'application/octet-stream',   // .skill files
          'application/zip',            // .zip archives
          'text/plain'                  // text-based skills
        ]
      });

      if (createError) {
        console.error('Error creating bucket:', createError);
        return {
          success: false,
          error: `Failed to create bucket: ${createError.message}`
        };
      }

      console.log(`✅ Bucket created: ${userId}`);
    }

    // Upload or update file with proper options
    const { data, error } = await supabase.storage
      .from(userId)
      .upload(MCP_FILE_NAME, blob, {
        contentType: 'application/json',
        cacheControl: '3600', // Cache for 1 hour
        upsert: true // Overwrite if exists
      });

    if (error) {
      console.error('Error uploading file:', error);
      return {
        success: false,
        error: `Upload failed: ${error.message}`
      };
    }

    console.log(`✅ MCP servers config uploaded: ${userId}/${MCP_FILE_NAME}`);

    return {
      success: true,
      data,
      path: data?.path || MCP_FILE_NAME
    };
  } catch (error) {
    console.error('Unexpected error in uploadMCPServersConfig:', error);
    return {
      success: false,
      error: `Unexpected error: ${error.message}`
    };
  }
};

/**
 * Export config as downloadable file
 * @param {object} config - MCP configuration object
 * @param {string} userId - User ID
 */
export const exportMCPConfigFile = (config, userId) => {
  const mcpJson = generateMCPJson(config, userId);
  const content = JSON.stringify(mcpJson, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = MCP_FILE_NAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * ============================================================
 * SKILL STORAGE FUNCTIONS
 * ============================================================
 */

const SKILLS_DIR = 'skills';

/**
 * Upload skill file to Supabase Storage
 * @param {string} userId - User ID (bucket name)
 * @param {File} file - Skill file (.skill or .zip)
 * @returns {Promise<{success: boolean, error?: string, data?: any, path?: string}>}
 */
export const uploadSkillFile = async (userId, file) => {
  try {
    const supabase = await initSupabase();

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID' };
    }

    // Validate file
    if (!file || !(file instanceof File)) {
      return { success: false, error: 'Invalid file' };
    }

    // Validate file extension
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.skill') && !fileName.endsWith('.zip')) {
      return { success: false, error: 'Only .skill or .zip files are allowed' };
    }

    // Validate file size (8MB limit)
    const maxSize = 8 * 1024 * 1024; // 8MB
    if (file.size > maxSize) {
      return {
        success: false,
        error: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds 8MB limit`
      };
    }

    // Create bucket if not exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      console.error('Error listing buckets:', listError);
      return {
        success: false,
        error: `Failed to list buckets: ${listError.message}`
      };
    }

    const bucketExists = buckets?.some(b => b.name === userId);

    if (!bucketExists) {
      console.log(`Creating private bucket for user: ${userId}`);

      const { error: createError } = await supabase.storage.createBucket(userId, {
        public: false,
        fileSizeLimit: 8 * 1024 * 1024, // 8MB
        allowedMimeTypes: ['application/octet-stream', 'application/zip', 'text/plain']
      });

      if (createError) {
        console.error('Error creating bucket:', createError);
        return {
          success: false,
          error: `Failed to create bucket: ${createError.message}`
        };
      }

      console.log(`✅ Bucket created: ${userId}`);
    }

    // Upload skill file to skills/ directory
    const skillPath = `${SKILLS_DIR}/${file.name}`;
    const { data, error } = await supabase.storage
      .from(userId)
      .upload(skillPath, file, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: true // Overwrite if exists
      });

    if (error) {
      console.error('Error uploading skill file:', error);
      return {
        success: false,
        error: `Upload failed: ${error.message}`
      };
    }

    console.log(`✅ Skill file uploaded: ${userId}/${skillPath}`);

    return {
      success: true,
      data,
      path: data?.path || skillPath
    };
  } catch (error) {
    console.error('Unexpected error in uploadSkillFile:', error);
    return {
      success: false,
      error: `Unexpected error: ${error.message}`
    };
  }
};

/**
 * List all skill files for a user
 * @param {string} userId - User ID (bucket name)
 * @returns {Promise<{success: boolean, error?: string, skills?: Array}>}
 */
export const listSkillFiles = async (userId) => {
  try {
    const supabase = await initSupabase();

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID' };
    }

    const { data, error } = await supabase.storage
      .from(userId)
      .list(SKILLS_DIR, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) {
      // If skills directory doesn't exist yet, return empty list
      if (error.message.includes('not found') || error.message.includes('does not exist')) {
        return { success: true, skills: [] };
      }

      console.error('Error listing skill files:', error);
      return { success: false, error: error.message };
    }

    // Filter only .skill and .zip files
    const skills = (data || []).filter(file =>
      file.name.endsWith('.skill') || file.name.endsWith('.zip')
    );

    return { success: true, skills };
  } catch (error) {
    console.error('Unexpected error in listSkillFiles:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete skill file
 * @param {string} userId - User ID (bucket name)
 * @param {string} skillFileName - Skill file name
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteSkillFile = async (userId, skillFileName) => {
  try {
    const supabase = await initSupabase();

    const skillPath = `${SKILLS_DIR}/${skillFileName}`;
    const { error } = await supabase.storage
      .from(userId)
      .remove([skillPath]);

    if (error) {
      console.error('Error deleting skill file:', error);
      return { success: false, error: error.message };
    }

    console.log(`✅ Skill file deleted: ${userId}/${skillPath}`);
    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteSkillFile:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Download skill file
 * @param {string} userId - User ID (bucket name)
 * @param {string} skillFileName - Skill file name
 * @returns {Promise<{success: boolean, error?: string, data?: Blob}>}
 */
export const downloadSkillFile = async (userId, skillFileName) => {
  try {
    const supabase = await initSupabase();

    const skillPath = `${SKILLS_DIR}/${skillFileName}`;
    const { data, error } = await supabase.storage
      .from(userId)
      .download(skillPath);

    if (error) {
      console.error('Error downloading skill file:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Unexpected error in downloadSkillFile:', error);
    return { success: false, error: error.message };
  }
};
