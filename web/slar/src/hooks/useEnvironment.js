'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '../lib/api';

// Global cache to share config across all hook instances
let globalConfig = null;
let globalEnv = null;
let globalLoading = true;
let fetchPromise = null;

// Fetch config once and cache it using apiClient
const fetchEnvironmentConfig = () => {
  if (fetchPromise) return fetchPromise;

  fetchPromise = apiClient.getEnvConfig()
    .then(data => {
      globalEnv = data.env || 'unknown';
      globalConfig = data;
      globalLoading = false;
      return { env: globalEnv, config: globalConfig };
    })
    .catch(err => {
      console.error('Failed to fetch environment:', err);
      globalEnv = 'error';
      globalLoading = false;
      return { env: 'error', config: null };
    });

  return fetchPromise;
};

/**
 * Custom hook to get environment information from backend
 * Uses global cache to avoid multiple fetches
 *
 * @returns {Object} Environment info
 * @returns {string} env - Current environment (development/staging/production/error)
 * @returns {boolean} loading - Whether the config is still loading
 * @returns {Object} config - Full config object from backend
 * @returns {boolean} isDevelopment - True if env is development
 * @returns {boolean} isStaging - True if env is staging
 * @returns {boolean} isProduction - True if env is production
 *
 * @example
 * const { env, isDevelopment, config } = useEnvironment();
 *
 * if (isDevelopment) {
 *   console.log('Running in development mode');
 * }
 */
export function useEnvironment() {
  const [env, setEnv] = useState(globalEnv);
  const [config, setConfig] = useState(globalConfig);
  const [loading, setLoading] = useState(globalLoading);

  useEffect(() => {
    // If already loaded from cache, use it
    if (globalEnv !== null) {
      setEnv(globalEnv);
      setConfig(globalConfig);
      setLoading(false);
      return;
    }

    // Otherwise fetch
    fetchEnvironmentConfig().then(({ env, config }) => {
      setEnv(env);
      setConfig(config);
      setLoading(false);
    });
  }, []);

  return {
    env,
    loading,
    config,
    isDevelopment: env === 'development',
    isStaging: env === 'staging',
    isProduction: env === 'production',
    isError: env === 'error',
  };
}

export default useEnvironment;

