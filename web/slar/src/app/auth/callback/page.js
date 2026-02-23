'use client';

/**
 * Auth Callback Page
 *
 * This page is no longer used with NextAuth.js as callbacks are handled
 * automatically at /api/auth/callback/oidc.
 *
 * This page now just shows a loading state and redirects to dashboard
 * in case users land here directly.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../contexts/AuthContext';

export default function AuthCallback() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    // If user is authenticated, go to dashboard
    // If not and loading is done, go to login
    if (!loading) {
      if (isAuthenticated) {
        router.push('/incidents');
      } else {
        router.push('/login');
      }
    }
  }, [isAuthenticated, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="text-center max-w-md px-6">
        {/* Loading State */}
        <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Processing authentication...
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Please wait while we complete your authentication.
        </p>
      </div>
    </div>
  );
}
