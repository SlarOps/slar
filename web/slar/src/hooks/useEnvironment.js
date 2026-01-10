'use client';

/**
 * Custom hook to get environment information
 * Reads from NEXT_PUBLIC_ENV or defaults to 'development'
 *
 * @returns {Object} Environment info
 * @returns {string} env - Current environment (development/staging/production)
 * @returns {boolean} loading - Always false (no async fetch needed)
 * @returns {boolean} isDevelopment - True if env is development
 * @returns {boolean} isStaging - True if env is staging
 * @returns {boolean} isProduction - True if env is production
 */
export function useEnvironment() {
  // Read environment from env var or default to development
  const env = process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV || 'development';

  return {
    env,
    loading: false,
    config: null,
    isDevelopment: env === 'development',
    isStaging: env === 'staging',
    isProduction: env === 'production',
    isError: false,
  };
}

export default useEnvironment;
