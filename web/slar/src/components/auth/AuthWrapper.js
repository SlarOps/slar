'use client';

import { useAuth } from '../../contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import { apiClient } from '../../lib/api';

const PUBLIC_ROUTES = ['/login', '/signup', '/auth/callback', '/', '/onboarding', '/shared'];

export default function AuthWrapper({ children }) {
  const { user, session, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  // Refs to prevent redundant checks
  const lastCheckedUserIdRef = useRef(null);
  const isCheckingRef = useRef(false);

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname) || pathname.startsWith('/shared/');
  const isOnboardingPage = pathname === '/onboarding';

  // Handle session invalidation (401 from API)
  const handleSessionInvalid = useCallback(async () => {
    console.log('Session invalid (401), signing out...');
    await signOut();
    router.push('/login');
  }, [signOut, router]);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      // Skip if already checked for this user, on onboarding page, or no session
      if (isOnboardingPage || !session?.access_token || !user?.id) {
        return;
      }

      // Skip if already checked for this user (prevents re-check on session refresh)
      if (lastCheckedUserIdRef.current === user.id) {
        return;
      }

      // Prevent concurrent checks
      if (isCheckingRef.current) {
        return;
      }

      try {
        isCheckingRef.current = true;
        setCheckingOnboarding(true);
        apiClient.setToken(session.access_token);
        const data = await apiClient.getOrganizations();
        const orgs = Array.isArray(data) ? data : (data?.organizations || []);

        // Mark as checked for this user
        lastCheckedUserIdRef.current = user.id;
        setOnboardingChecked(true);

        if (orgs.length === 0) {
          // No organizations - redirect to onboarding
          router.push('/onboarding');
        }
      } catch (err) {
        // Check if it's an auth-related error - sign out and redirect to login
        // 401 = Unauthorized (token invalid/expired)
        // 403 = Forbidden (token valid but user not authorized, often due to OIDC mismatch)
        if (err.status === 401 || err.status === 403) {
          console.log(`Auth error (${err.status}), signing out:`, err.message);
          await handleSessionInvalid();
          return;
        }
        // For other errors (network, server errors), log and let user retry
        // Don't redirect to onboarding - that's only for users with no orgs
        console.error('Onboarding check failed:', err.message);
        // Mark as checked to prevent infinite retries, user can refresh to retry
        lastCheckedUserIdRef.current = user.id;
        setOnboardingChecked(true);
      } finally {
        isCheckingRef.current = false;
        setCheckingOnboarding(false);
      }
    };

    if (!loading) {
      if (!user && !isPublicRoute) {
        // Redirect to login if not authenticated and not on public route
        router.push('/login');
      } else if (user && (pathname === '/login' || pathname === '/signup')) {
        // Redirect to dashboard if authenticated and on auth pages
        router.push('/incidents');
      } else if (user && !isOnboardingPage && lastCheckedUserIdRef.current !== user.id) {
        // Check if user needs onboarding (no organizations)
        // Only check if we haven't checked for this specific user yet
        checkOnboardingStatus();
      }
    }
  }, [user?.id, loading, pathname, router, isPublicRoute, isOnboardingPage, handleSessionInvalid]); // Removed session from deps

  // Show loading spinner while checking authentication or onboarding status
  if (loading || checkingOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {checkingOnboarding ? 'Setting up your workspace...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  // Show content if on public route or authenticated
  if (isPublicRoute || user) {
    return children;
  }

  // This shouldn't be reached due to the redirect in useEffect
  return null;
}
