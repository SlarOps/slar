'use client';

import { getConfigSync } from '../lib/config';

/**
 * Custom hook to get environment information
 * Reads from runtime config or defaults to 'development'
 *
 * @returns {Object} Environment info
 * @returns {string} env - Current environment (development/staging/production)
 * @returns {boolean} loading - Always false (no async fetch needed)
 * @returns {boolean} isDevelopment - True if env is development
 * @returns {boolean} isStaging - True if env is staging
 * @returns {boolean} isProduction - True if env is production
 */
export function useEnvironment() {
  // Read environment from runtime config
  const config = getConfigSync();
  const env = config.env || 'development';

  return {
    env,
    loading: false,
    config,
    isDevelopment: env === 'development',
    isStaging: env === 'staging',
    isProduction: env === 'production',
    isError: false,
  };
}

export default useEnvironment;
