'use client';

import { useEnvironment } from '../hooks/useEnvironment';

/**
 * EnvironmentBadge component
 * Displays the current environment (dev/staging/prod) in a badge
 * Fetches environment info from backend /api/health endpoint
 * Only shows for non-production environments
 */
export default function EnvironmentBadge() {
  const { env, loading, isProduction } = useEnvironment();

  // Don't show badge for production or while loading
  if (loading || !env || isProduction) {
    return null;
  }

  const getBadgeColor = () => {
    switch (env) {
      case 'development':
        return 'bg-blue-500 text-white';
      case 'staging':
        return 'bg-yellow-500 text-black';
      case 'error':
        return 'bg-red-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`px-3 py-1 rounded-full text-xs font-semibold shadow-lg ${getBadgeColor()}`}>
        {env.toUpperCase()}
      </div>
    </div>
  );
}

