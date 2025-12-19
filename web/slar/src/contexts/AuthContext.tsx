'use client';

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { auth, initSupabase } from '../lib/supabase';
import apiClient from '../lib/api';

// Types
interface User {
  id: string;
  email?: string;
  [key: string]: any;
}

interface Session {
  access_token: string;
  refresh_token?: string;
  user?: User;
  [key: string]: any;
}

interface AuthResult<T = any> {
  data: T | null;
  error: Error | null;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, metadata?: Record<string, any>) => Promise<AuthResult>;
  signOut: () => Promise<{ error: Error | null }>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  isAuthenticated: boolean;
}

const defaultContextValue: AuthContextValue = {
  user: null,
  session: null,
  loading: true,
  signIn: async () => ({ data: null, error: null }),
  signUp: async () => ({ data: null, error: null }),
  signOut: async () => ({ error: null }),
  resetPassword: async () => ({ data: null, error: null }),
  updatePassword: async () => ({ data: null, error: null }),
  isAuthenticated: false,
};

const AuthContext = createContext<AuthContextValue>(defaultContextValue);

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

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Track current session to avoid redundant updates
  const currentSessionRef = useRef<string | null>(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    // Initialize Supabase and setup auth
    const initAuth = async () => {
      try {
        // Initialize Supabase client first
        await initSupabase();

        // Get initial session and validate it
        const { session, error } = await auth.getSession();

        if (error) {
          console.error('Session error:', error);
          // Clear invalid session from storage
          if (error.message?.includes('session_id claim') ||
            error.message?.includes('JWT') ||
            error.message?.includes('does not exist')) {
            console.log('Clearing invalid session from storage');
            localStorage.removeItem('slar-auth-token');
            setSession(null);
            setUser(null);
          }
        } else if (session) {
          // Validate session by trying to get user
          const { user: validUser, error: userError } = await auth.getUser();

          if (userError) {
            console.error('User validation error:', userError);
            // Session is invalid, clear it
            console.log('Clearing invalid session');
            localStorage.removeItem('slar-auth-token');
            currentSessionRef.current = null;
            setSession(null);
            setUser(null);
          } else {
            // Session is valid - track it
            currentSessionRef.current = session.access_token;
            isInitializedRef.current = true;
            setSession(session);
            setUser(validUser);
            if (session.access_token) {
              apiClient.setToken(session.access_token);
            }
          }
        } else {
          // No session
          setSession(null);
          setUser(null);
        }

        // Listen for auth changes (use async version)
        const { data } = await auth.onAuthStateChangeAsync(
          async (event: string, newSession: Session | null) => {
            // Skip if session hasn't actually changed (prevents unnecessary re-renders)
            const newToken = newSession?.access_token || null;
            const isSameSession = newToken === currentSessionRef.current;

            if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
              // Clear storage on sign out
              console.log('Auth state changed:', event);
              localStorage.removeItem('slar-auth-token');
              currentSessionRef.current = null;
              setSession(null);
              setUser(null);
              apiClient.setToken(null);
            } else if (event === 'SIGNED_IN') {
              // Skip SIGNED_IN if we already have this session (avoid re-mount)
              if (isSameSession && isInitializedRef.current) {
                console.log('Auth state changed: SIGNED_IN (skipped - same session)');
                return;
              }
              console.log('Auth state changed:', event, newSession);
              currentSessionRef.current = newToken;
              isInitializedRef.current = true;
              setSession(newSession);
              setUser(newSession?.user || null);
              if (newSession?.access_token) {
                apiClient.setToken(newSession.access_token);
              }
            } else if (event === 'TOKEN_REFRESHED') {
              // Token refresh - update silently without triggering cascading re-renders
              console.log('Auth state changed: TOKEN_REFRESHED');
              currentSessionRef.current = newToken;
              // Only update if token actually changed
              if (!isSameSession) {
                setSession(newSession);
                setUser(newSession?.user || null);
              }
              if (newSession?.access_token) {
                apiClient.setToken(newSession.access_token);
              }
            } else {
              console.log('Auth state changed:', event);
              if (!isSameSession) {
                currentSessionRef.current = newToken;
                setSession(newSession);
                setUser(newSession?.user || null);
              }
              if (newSession?.access_token) {
                apiClient.setToken(newSession.access_token);
              }
            }
          }
        );

        subscription = data.subscription;
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        // Clear any invalid data
        localStorage.removeItem('slar-auth-token');
        setSession(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    setLoading(true);
    try {
      const { data, error } = await auth.signIn(email, password);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { data: null, error: error as Error };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, metadata: Record<string, any> = {}): Promise<AuthResult> => {
    setLoading(true);
    try {
      const { data, error } = await auth.signUp(email, password, metadata);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Sign up error:', error);
      return { data: null, error: error as Error };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<{ error: Error | null }> => {
    setLoading(true);
    try {
      const { error } = await auth.signOut();

      // Clear local state even if signOut fails (e.g., session already expired)
      setUser(null);
      setSession(null);

      // Only throw if it's not a session missing error
      if (error && error.message !== 'Auth session missing!') {
        throw error;
      }

      return { error: null };
    } catch (error) {
      console.error('Sign out error:', error);

      // Still clear local state on error
      setUser(null);
      setSession(null);

      return { error: error as Error };
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string): Promise<AuthResult> => {
    try {
      const { data, error } = await auth.resetPassword(email);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Reset password error:', error);
      return { data: null, error: error as Error };
    }
  };

  const updatePassword = async (password: string): Promise<AuthResult> => {
    try {
      const { data, error } = await auth.updatePassword(password);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Update password error:', error);
      return { data: null, error: error as Error };
    }
  };

  const value: AuthContextValue = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
