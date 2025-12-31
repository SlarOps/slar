/**
 * GitHub Marketplace Integration
 * Fetches skills and plugins from GitHub repositories
 *
 * NEW APPROACH (Lightweight):
 * - Fetch metadata only via GitHub API
 * - Store metadata in PostgreSQL (instant!)
 * - Download plugin files on demand (lazy loading)
 */

/**
 * Decode JWT token to extract user_id (client-side, no verification)
 *
 * @param {string} authToken - JWT token (with or without "Bearer " prefix)
 * @returns {string} user_id from token's 'sub' claim
 * @throws {Error} if token is invalid or user_id not found
 */
function getUserIdFromToken(authToken) {
  try {
    const token = authToken.replace('Bearer ', '').trim();
    // JWT format: header.payload.signature
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userId = payload.sub; // user_id is in 'sub' claim

    if (!userId) {
      throw new Error('user_id (sub) not found in token payload');
    }

    return userId;
  } catch (error) {
    throw new Error(`Failed to decode JWT token: ${error.message}`);
  }
}

const MARKETPLACE_REPOS = [
  {
    owner: 'anthropics',
    repo: 'skills',
    branch: 'main',
    type: 'skills'
  }
  // Add more marketplace repos here
];

/**
 * Fetch repository contents from GitHub
 */
export async function fetchGitHubRepo(owner, repo, path = '', branch = 'main') {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        // Add GitHub token if needed for higher rate limits
        // 'Authorization': `token ${process.env.NEXT_PUBLIC_GITHUB_TOKEN}`
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching from GitHub:', error);
    return null;
  }
}

/**
 * Fetch file content from GitHub
 */
export async function fetchGitHubFile(owner, repo, path, branch = 'main') {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3.raw',
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error('Error fetching file from GitHub:', error);
    return null;
  }
}

/**
 * Parse skill metadata from SKILL.md content
 */
export function parseSkillMetadata(content) {
  try {
    // Extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const metadata = {};

    // Parse YAML (simple parser for common fields)
    frontmatter.split('\n').forEach(line => {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        metadata[key] = value.replace(/^["']|["']$/g, ''); // Remove quotes
      }
    });

    // Extract description from content (after frontmatter)
    const contentAfterFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    const firstParagraph = contentAfterFrontmatter
      .split('\n\n')[0]
      .replace(/^#.*\n/, '') // Remove title
      .trim();

    return {
      name: metadata.name || 'Unknown',
      version: metadata.version || '1.0.0',
      description: metadata.description || firstParagraph || 'No description available',
      author: metadata.author || 'Community',
      tags: metadata.tags ? metadata.tags.replace(/[\[\]]/g, '').split(',').map(t => t.trim()) : [],
      ...metadata
    };
  } catch (error) {
    console.error('Error parsing skill metadata:', error);
    return null;
  }
}

/**
 * Fetch all skills from a GitHub repository
 */
export async function fetchSkillsFromRepo(owner, repo, branch = 'main') {
  try {
    // Get repository structure
    const contents = await fetchGitHubRepo(owner, repo, '', branch);

    if (!contents || !Array.isArray(contents)) {
      return [];
    }

    const skills = [];

    // Look for SKILL.md files in directories
    for (const item of contents) {
      if (item.type === 'dir') {
        // Check if directory contains SKILL.md
        const dirContents = await fetchGitHubRepo(owner, repo, item.path, branch);

        if (dirContents && Array.isArray(dirContents)) {
          const skillFile = dirContents.find(file =>
            file.name === 'SKILL.md' || file.name.endsWith('.skill')
          );

          if (skillFile) {
            // Fetch and parse skill content
            const content = await fetchGitHubFile(owner, repo, skillFile.path, branch);

            if (content) {
              const metadata = parseSkillMetadata(content);

              if (metadata) {
                skills.push({
                  id: `${owner}/${repo}/${item.name}`,
                  name: metadata.name || item.name,
                  version: metadata.version || '1.0.0',
                  description: metadata.description || 'No description available',
                  author: metadata.author || owner,
                  category: 'community',
                  icon: '📦',
                  rating: 0,
                  downloads: 0,
                  tags: metadata.tags || [],
                  installed: false,
                  featured: false,
                  repository: `https://github.com/${owner}/${repo}`,
                  repositoryPath: item.path,
                  downloadUrl: `https://github.com/${owner}/${repo}/tree/${branch}/${item.path}`,
                  components: {
                    skills: 1,
                    mcpServers: 0,
                    commands: 0
                  }
                });
              }
            }
          }
        }
      }
    }

    return skills;
  } catch (error) {
    console.error('Error fetching skills from repo:', error);
    return [];
  }
}

/**
 * Fetch all marketplace items from configured repositories
 */
export async function fetchMarketplaceItems() {
  try {
    const allItems = [];

    for (const repoConfig of MARKETPLACE_REPOS) {
      const items = await fetchSkillsFromRepo(
        repoConfig.owner,
        repoConfig.repo,
        repoConfig.branch
      );

      allItems.push(...items);
    }

    return allItems;
  } catch (error) {
    console.error('Error fetching marketplace items:', error);
    return [];
  }
}

/**
 * Download skill from GitHub
 */
export async function downloadSkillFromGitHub(owner, repo, path, branch = 'main') {
  try {
    // Get all files in the skill directory
    const contents = await fetchGitHubRepo(owner, repo, path, branch);

    if (!contents || !Array.isArray(contents)) {
      throw new Error('Failed to fetch skill contents');
    }

    const files = {};

    for (const item of contents) {
      if (item.type === 'file') {
        const content = await fetchGitHubFile(owner, repo, item.path, branch);
        if (content) {
          files[item.name] = content;
        }
      }
    }

    return {
      success: true,
      files
    };
  } catch (error) {
    console.error('Error downloading skill:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fetch marketplace.json from repository
 */
export async function fetchMarketplaceJson(owner, repo, branch = 'main') {
  try {
    // Try common paths for marketplace.json
    const possiblePaths = [
      '.claude-plugin/marketplace.json',
      'marketplace.json',
      '.claude/marketplace.json'
    ];

    for (const path of possiblePaths) {
      try {
        const content = await fetchGitHubFile(owner, repo, path, branch);
        if (content) {
          return JSON.parse(content);
        }
      } catch (e) {
        // Try next path
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching marketplace.json:', error);
    return null;
  }
}

/**
 * Fetch plugins from marketplace.json
 */
export async function fetchPluginsFromMarketplace(owner, repo, branch = 'main') {
  try {
    const marketplace = await fetchMarketplaceJson(owner, repo, branch);

    if (!marketplace || !marketplace.plugins) {
      return null;
    }

    const plugins = [];

    for (const plugin of marketplace.plugins) {
      const pluginData = {
        id: `${owner}/${repo}/${plugin.name}`,
        name: plugin.name,
        description: plugin.description || 'No description available',
        source: plugin.source || './',
        strict: plugin.strict || false,
        skills: plugin.skills || [],
        repository: `https://github.com/${owner}/${repo}`,
        repositoryOwner: owner,
        repositoryName: repo,
        branch: branch,
        marketplaceName: marketplace.name,
        marketplaceOwner: marketplace.owner,
        version: marketplace.metadata?.version || '1.0.0'
      };

      plugins.push(pluginData);
    }

    return {
      marketplace: {
        name: marketplace.name,
        description: marketplace.metadata?.description,
        version: marketplace.metadata?.version,
        owner: marketplace.owner,
        repository: `https://github.com/${owner}/${repo}`
      },
      plugins
    };
  } catch (error) {
    console.error('Error fetching plugins from marketplace:', error);
    return null;
  }
}

/**
 * Download skill files from marketplace
 */
export async function downloadSkillFromMarketplace(owner, repo, skillPath, branch = 'main') {
  try {
    // Remove leading ./ if present
    const cleanPath = skillPath.replace(/^\.\//, '');

    // Get all files in the skill directory
    const contents = await fetchGitHubRepo(owner, repo, cleanPath, branch);

    if (!contents || !Array.isArray(contents)) {
      throw new Error('Failed to fetch skill contents');
    }

    const files = {};

    for (const item of contents) {
      if (item.type === 'file') {
        const content = await fetchGitHubFile(owner, repo, item.path, branch);
        if (content) {
          files[item.name] = content;
        }
      }
    }

    return {
      success: true,
      files
    };
  } catch (error) {
    console.error('Error downloading skill:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Clone entire repository using git clone
 * Backend handles: git clone → workspace
 *
 * Git-based approach (v2):
 * - Uses shallow git clone (--depth=1) for efficiency
 * - Updates via git fetch (incremental, fast)
 * - No ZIP files or S3 storage needed
 */
export async function downloadEntireMarketplace(owner, repo, branch = 'main', authToken, marketplaceName, onProgress) {
  try {
    console.log('[marketplaceGithub] Cloning repository via git:', { owner, repo, branch, marketplaceName });

    if (onProgress) {
      onProgress({
        current: 0,
        total: 1,
        skillName: 'Cloning repository...'
      });
    }

    // Call AI service endpoint to git clone
    const aiServiceUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(`${aiServiceUrl}/api/marketplace/clone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_token: authToken,
        owner,
        repo,
        branch: branch || 'main',
        marketplace_name: marketplaceName || `${owner}-${repo}`,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Backend returned status ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to clone repository');
    }

    console.log(`[marketplaceGithub] ✅ ${data.message} (commit: ${data.commit_sha?.slice(0, 8)})`);

    if (onProgress) {
      onProgress({
        current: 1,
        total: 1,
        skillName: 'Completed!'
      });
    }

    // Marketplace metadata is returned directly from backend (read from git clone)
    const marketplace = data.marketplace || {
      name: marketplaceName || `${owner}-${repo}`,
      owner: owner,
      plugins: []
    };

    return {
      success: true,
      marketplace,
      marketplaceName: marketplace.name,
      commitSha: data.commit_sha,
      // Legacy fields for backwards compatibility
      uploadedCount: 1,
      skippedCount: 0
    };
  } catch (error) {
    console.error('[marketplaceGithub] Error cloning repository:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update marketplace repository using git fetch
 * Performs incremental update - much faster than re-cloning
 */
export async function updateMarketplace(marketplaceName, authToken, onProgress) {
  try {
    console.log('[marketplaceGithub] Updating marketplace via git fetch:', { marketplaceName });

    if (onProgress) {
      onProgress({
        current: 0,
        total: 1,
        skillName: 'Fetching updates...'
      });
    }

    const aiServiceUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';
    const response = await fetch(`${aiServiceUrl}/api/marketplace/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_token: authToken,
        marketplace_name: marketplaceName,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Backend returned status ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to update marketplace');
    }

    if (onProgress) {
      onProgress({
        current: 1,
        total: 1,
        skillName: data.had_changes ? 'Updated!' : 'Already up to date'
      });
    }

    console.log(`[marketplaceGithub] ✅ ${data.message}`);

    return {
      success: true,
      hadChanges: data.had_changes,
      oldCommitSha: data.old_commit_sha,
      newCommitSha: data.new_commit_sha,
      message: data.message
    };
  } catch (error) {
    console.error('[marketplaceGithub] Error updating marketplace:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Add custom marketplace repository
 */
export function addMarketplaceRepo(owner, repo, branch = 'main', type = 'skills') {
  MARKETPLACE_REPOS.push({ owner, repo, branch, type });
}

/**
 * Get repository info
 */
export async function getRepoInfo(owner, repo) {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      url: data.html_url,
      homepage: data.homepage
    };
  } catch (error) {
    console.error('Error fetching repo info:', error);
    return null;
  }
}

/**
 * Parse GitHub URL to extract owner and repo
 */
export function parseGitHubUrl(url) {
  try {
    // Handle various GitHub URL formats
    const patterns = [
      /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,  // https://github.com/owner/repo or .git
      /github\.com\/([^/]+)\/([^/]+)/,               // https://github.com/owner/repo/...
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace(/\.git$/, '')
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error parsing GitHub URL:', error);
    return null;
  }
}

/**
 * ============================================================
 * NEW LIGHTWEIGHT APPROACH
 * ============================================================
 */

/**
 * Fetch marketplace metadata from GitHub API (lightweight!)
 * Only fetches marketplace.json (~10-50KB) instead of entire ZIP
 *
 * @param {string} owner - GitHub owner
 * @param {string} repo - GitHub repo
 * @param {string} branch - Branch name
 * @param {string} authToken - Supabase auth token
 * @param {string} marketplaceName - Optional marketplace name
 * @returns {Promise<{success: boolean, marketplace?: object, error?: string}>}
 */
export async function fetchMarketplaceMetadata(owner, repo, branch = 'main', authToken, marketplaceName = null) {
  try {
    console.log('[marketplaceGithub] 🌐 Fetching marketplace metadata (lightweight):', { owner, repo, branch });

    const aiServiceUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';

    const response = await fetch(`${aiServiceUrl}/api/marketplace/fetch-metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_token: authToken,
        owner,
        repo,
        branch,
        marketplace_name: marketplaceName || `${owner}-${repo}`
      }),
    });

    const result = await response.json();

    if (!result.success) {
      console.error('[marketplaceGithub] ❌ Failed to fetch metadata:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[marketplaceGithub] ✅ Metadata fetched successfully:', result.marketplace.name);
    console.log('[marketplaceGithub]    Plugins:', result.marketplace.plugins?.length || 0);

    return {
      success: true,
      marketplace: result.marketplace
    };
  } catch (error) {
    console.error('[marketplaceGithub] ❌ Error fetching metadata:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Install a plugin from marketplace (instant DB update!).
 *
 * Git-based approach:
 * - Plugin files already exist in workspace from git clone
 * - This only marks the plugin as installed in PostgreSQL (instant!)
 * - No file copying needed - plugins are loaded directly from git repo
 *
 * @param {string} marketplaceName - Marketplace name
 * @param {string} pluginName - Plugin name
 * @param {string} version - Plugin version
 * @param {string} authToken - Supabase auth token
 * @returns {Promise<{success: boolean, plugin?: object, error?: string}>}
 */
export async function installPluginFromMarketplace(
  marketplaceName,
  pluginName,
  version,
  authToken
) {
  try {
    console.log('[marketplaceGithub] 📦 Installing plugin (instant DB update):', {
      marketplaceName,
      pluginName,
      version
    });

    const aiServiceUrl = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';

    const response = await fetch(`${aiServiceUrl}/api/marketplace/install-plugin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_token: authToken,
        marketplace_name: marketplaceName,
        plugin_name: pluginName,
        version
      }),
    });

    const result = await response.json();

    if (!result.success) {
      console.error('[marketplaceGithub] ❌ Failed to install plugin:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[marketplaceGithub] ✅ Plugin installed successfully (instant!)');

    return {
      success: true,
      plugin: result.plugin
    };
  } catch (error) {
    console.error('[marketplaceGithub] ❌ Error installing plugin:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
