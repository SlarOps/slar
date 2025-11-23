'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { auth, initSupabase } from '../lib/supabase';
import apiClient from '../lib/api';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let subscription = null;

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
            setSession(null);
            setUser(null);
          } else {
            // Session is valid
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
          async (event, session) => {
            console.log('Auth state changed:', event, session);

            if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
              // Clear storage on sign out
              localStorage.removeItem('slar-auth-token');
              setSession(null);
              setUser(null);
              apiClient.setToken(null);
            } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
              setSession(session);
              setUser(session?.user || null);
              if (session?.access_token) {
                apiClient.setToken(session.access_token);
              }
            } else {
              setSession(session);
              setUser(session?.user || null);
              if (session?.access_token) {
                apiClient.setToken(session.access_token);
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

  const signIn = async (email, password) => {
    setLoading(true);
    try {
      const { data, error } = await auth.signIn(email, password);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email, password, metadata = {}) => {
    setLoading(true);
    try {
      const { data, error } = await auth.signUp(email, password, metadata);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Sign up error:', error);
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
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

      return { error };
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email) => {
    try {
      const { data, error } = await auth.resetPassword(email);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Reset password error:', error);
      return { data: null, error };
    }
  };

  const updatePassword = async (password) => {
    try {
      const { data, error } = await auth.updatePassword(password);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Update password error:', error);
      return { data: null, error };
    }
  };

  const value = {
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
