'use client';

import { useAuth } from '../../contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { apiClient } from '../../lib/api';

const PUBLIC_ROUTES = ['/login', '/signup', '/auth/callback', '/', '/onboarding'];

export default function AuthWrapper({ children }) {
  const { user, session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  // Refs to prevent redundant checks
  const lastCheckedUserIdRef = useRef(null);
  const isCheckingRef = useRef(false);

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isOnboardingPage = pathname === '/onboarding';

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
        // If API fails, still redirect to onboarding (user likely has no orgs)
        console.log('Onboarding check failed, redirecting to onboarding:', err.message);
        router.push('/onboarding');
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
        router.push('/dashboard');
      } else if (user && !isOnboardingPage && lastCheckedUserIdRef.current !== user.id) {
        // Check if user needs onboarding (no organizations)
        // Only check if we haven't checked for this specific user yet
        checkOnboardingStatus();
      }
    }
  }, [user?.id, loading, pathname, router, isPublicRoute, isOnboardingPage]); // Removed session from deps

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
