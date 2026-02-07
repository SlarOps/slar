/**
 * Runtime Configuration Manager
 * 
 * Handles dynamic runtime configuration for Next.js apps.
 * - Server-side: Uses process.env directly
 * - Client-side: Fetches from /api/config and caches the result
 * 
 * This approach allows the same Docker image to be used across environments
 * without rebuilding.
 */

// Default fallback values
const DEFAULTS = {
  apiUrl: '/api',
  aiApiUrl: '/ai',
  aiWsUrl: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
  env: 'development',
};

// Singleton state
let configCache = null;
let configPromise = null;

/**
 * Check if running on server side
 */
function isServer() {
  return typeof window === 'undefined';
}

/**
 * Get config synchronously (server-side only, or from cache on client)
 * Returns defaults if config not yet loaded on client
 */
export function getConfigSync() {
  if (isServer()) {
    // Server-side: read from process.env directly
    return {
      apiUrl: process.env.NEXT_PUBLIC_API_URL || DEFAULTS.apiUrl,
      aiApiUrl: process.env.NEXT_PUBLIC_AI_API_URL || DEFAULTS.aiApiUrl,
      aiWsUrl: process.env.NEXT_PUBLIC_AI_WS_URL || DEFAULTS.aiWsUrl,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULTS.supabaseUrl,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULTS.supabaseAnonKey,
      env: process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV || DEFAULTS.env,
    };
  }

  // Client-side: return from cache or defaults
  return configCache || DEFAULTS;
}

/**
 * Fetch config from API (client-side only)
 * Returns cached config if already loaded
 */
export async function fetchConfig() {
  if (isServer()) {
    return getConfigSync();
  }

  // Return cached config
  if (configCache) {
    return configCache;
  }

  // Return existing promise if fetch in progress
  if (configPromise) {
    return configPromise;
  }

  // Fetch from API
  configPromise = fetch('/api/config')
    .then(res => {
      if (!res.ok) {
        throw new Error(`Config fetch failed: ${res.status}`);
      }
      return res.json();
    })
    .then(config => {
      configCache = config;
      configPromise = null;
      console.log('[Config] Loaded runtime config:', {
        apiUrl: config.apiUrl,
        aiApiUrl: config.aiApiUrl,
        env: config.env,
      });
      return config;
    })
    .catch(err => {
      console.error('[Config] Failed to fetch config:', err);
      configPromise = null;
      // Return defaults on error
      return DEFAULTS;
    });

  return configPromise;
}

/**
 * Initialize config - call this early in your app
 * E.g., in _app.js or layout.js
 */
export function initConfig() {
  if (!isServer()) {
    fetchConfig();
  }
}

/**
 * Get a specific config value
 * @param {string} key - Config key (apiUrl, aiApiUrl, etc.)
 * @param {string} fallback - Fallback value if not found
 */
export function getConfig(key, fallback = '') {
  const config = getConfigSync();
  return config[key] ?? fallback;
}

/**
 * Update config URLs dynamically (useful for testing)
 */
export function setConfig(updates) {
  if (!isServer() && configCache) {
    configCache = { ...configCache, ...updates };
  }
}

/**
 * Clear config cache (for testing)
 */
export function clearConfigCache() {
  configCache = null;
  configPromise = null;
}

// Re-export defaults for reference
export { DEFAULTS as CONFIG_DEFAULTS };
