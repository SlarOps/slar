import { initSupabase } from './supabase';

/**
 * Skill Storage Helper Functions
 *
 * NOTE: MCP servers are now stored in PostgreSQL (user_mcp_servers table).
 * Use workspaceManager.js functions for MCP operations:
 * - getMCPServersFromDB() - Get MCP servers from PostgreSQL
 * - saveMCPServerToDB() - Save MCP server to PostgreSQL
 * - deleteMCPServerFromDB() - Delete MCP server from PostgreSQL
 *
 * This file only contains skill storage functions for Supabase Storage.
 */

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
