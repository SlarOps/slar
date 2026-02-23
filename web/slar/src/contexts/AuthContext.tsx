'use client';

/**
 * OIDC Authentication Context
 *
 * Provides authentication state and methods using NextAuth.js with any OIDC provider.
 *
 * Usage:
 *   import { useAuth } from '@/contexts/AuthContext';
 *   const { user, signIn, signOut, isAuthenticated } = useAuth();
 */

import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut, SessionProvider } from 'next-auth/react';
import apiClient from '../lib/api';

// Types
interface User {
  id: string;
  email?: string;
  name?: string;
  image?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
  roles?: string[];
  groups?: string[];
  [key: string]: any;
}

interface Session {
  access_token: string;
  user?: User;
  error?: string;
  [key: string]: any;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<{ error: Error | null }>;
  isAuthenticated: boolean;
}

const defaultContextValue: AuthContextValue = {
  user: null,
  session: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => ({ error: null }),
  isAuthenticated: false,
};

export const AuthContext = createContext<AuthContextValue>(defaultContextValue);

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Internal provider that uses NextAuth hooks
 */
function AuthProviderInner({ children }: AuthProviderProps) {
  const { data: nextAuthSession, status } = useSession();
  const loading = status === 'loading';

  // Transform NextAuth session to our format
  const user: User | null = nextAuthSession?.user ? {
    id: (nextAuthSession.user as any).id || nextAuthSession.user.email || '',
    email: nextAuthSession.user.email || undefined,
    name: nextAuthSession.user.name || undefined,
    image: nextAuthSession.user.image || undefined,
    user_metadata: {
      full_name: nextAuthSession.user.name || undefined,
      avatar_url: nextAuthSession.user.image || undefined,
    },
    roles: (nextAuthSession.user as any).roles || [],
    groups: (nextAuthSession.user as any).groups || [],
  } : null;

  const session: Session | null = nextAuthSession ? {
    access_token: (nextAuthSession as any).accessToken || '',
    user,
    error: (nextAuthSession as any).error,
  } : null;

  // Update API client token when session changes
  useEffect(() => {
    if (session?.access_token) {
      apiClient.setToken(session.access_token);
    } else {
      apiClient.setToken(null);
    }
  }, [session?.access_token]);

  // Handle token refresh errors
  useEffect(() => {
    if ((nextAuthSession as any)?.error === 'RefreshAccessTokenError') {
      console.warn('Token refresh failed, signing out...');
      nextAuthSignOut({ callbackUrl: '/login' });
    }
  }, [(nextAuthSession as any)?.error]);

  const signIn = async () => {
    try {
      await nextAuthSignIn('oidc', { callbackUrl: '/incidents' });
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  const signOut = async (): Promise<{ error: Error | null }> => {
    try {
      await nextAuthSignOut({ callbackUrl: '/login' });
      apiClient.setToken(null);
      return { error: null };
    } catch (error) {
      console.error('Sign out error:', error);
      apiClient.setToken(null);
      return { error: error as Error };
    }
  };

  const value: AuthContextValue = {
    user,
    session,
    loading,
    signIn,
    signOut,
    isAuthenticated: !!user && status === 'authenticated',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Main provider that wraps NextAuth SessionProvider
 */
export const AuthProvider = ({ children }: AuthProviderProps) => {
  return (
    <SessionProvider>
      <AuthProviderInner>
        {children}
      </AuthProviderInner>
    </SessionProvider>
  );
};
