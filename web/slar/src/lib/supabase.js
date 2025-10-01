import { createClient } from '@supabase/supabase-js'
import { apiClient } from './api'

// Singleton instance
let supabaseInstance = null;
let configPromise = null;
let isInitializing = false;

// Fetch config from unified /api/env endpoint using apiClient
const fetchConfig = async () => {
  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const data = await apiClient.getEnvConfig();
      return {
        supabaseUrl: data.supabase_url || 'http://localhost:8000',
        supabaseAnonKey: data.supabase_anon_key || '1234567890',
        env: data.env || 'unknown',
      };
    } catch (err) {
      console.error('Failed to fetch config, using fallback:', err);
      return {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:8000',
        supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '1234567890',
        env: 'error',
      };
    }
  })();

  return configPromise;
};

// Get or create Supabase client (singleton pattern)
const getSupabaseClient = async () => {
  // Return existing instance if already created
  if (supabaseInstance) {
    return supabaseInstance;
  }

  // Wait if another call is already initializing
  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return supabaseInstance;
  }

  // Mark as initializing
  isInitializing = true;

  try {
    const config = await fetchConfig();

    // Double-check instance wasn't created while we were fetching config
    if (supabaseInstance) {
      return supabaseInstance;
    }

    console.log('✅ Creating Supabase client instance:', {
      url: config.supabaseUrl,
      hasAnonKey: !!config.supabaseAnonKey,
      anonKeyLength: config.supabaseAnonKey?.length,
      env: config.env,
      source: '/api/env (unified config)'
    });

    supabaseInstance = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Use a consistent storage key
        storageKey: 'slar-auth-token',
      }
    });

    return supabaseInstance;
  } finally {
    isInitializing = false;
  }
};

// For backward compatibility - lazy initialization
export const supabase = new Proxy({}, {
  get(target, prop) {
    if (!supabaseInstance) {
      throw new Error('Supabase client not initialized. Use getSupabaseClient() or initSupabase() first.');
    }
    return supabaseInstance[prop];
  }
});

// Initialize supabase client
export const initSupabase = async () => {
  return await getSupabaseClient();
};

// Auth helper functions
export const auth = {
  // Sign in with email and password
  async signIn(email, password) {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  },

  // Sign up with email and password
  async signUp(email, password, metadata = {}) {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: metadata
      }
    })
    return { data, error }
  },

  // Sign out
  async signOut() {
    const client = await getSupabaseClient();
    const { error } = await client.auth.signOut()
    return { error }
  },

  // Get current user
  async getUser() {
    const client = await getSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser()
    return { user, error }
  },

  // Get current session
  async getSession() {
    const client = await getSupabaseClient();
    const { data: { session }, error } = await client.auth.getSession()

    // If session error is related to invalid JWT, clear storage
    if (error && (
      error.message?.includes('session_id claim') ||
      error.message?.includes('JWT') ||
      error.message?.includes('does not exist')
    )) {
      console.warn('Invalid session detected, clearing storage');
      localStorage.removeItem('slar-auth-token');
      return { session: null, error };
    }

    return { session, error }
  },

  // Reset password
  async resetPassword(email) {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    })
    return { data, error }
  },

  // Update user password
  async updatePassword(password) {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.updateUser({
      password: password
    })
    return { data, error }
  },

  // Subscribe to auth changes (async version)
  async onAuthStateChangeAsync(callback) {
    const client = await getSupabaseClient();
    return client.auth.onAuthStateChange(callback);
  },

  // Subscribe to auth changes (sync version - for backward compatibility)
  onAuthStateChange(callback) {
    // If client is already initialized, use it
    if (supabaseInstance) {
      return supabaseInstance.auth.onAuthStateChange(callback);
    }

    // Otherwise, initialize and setup subscription
    let actualSubscription = null;
    getSupabaseClient().then(client => {
      const { data } = client.auth.onAuthStateChange(callback);
      actualSubscription = data.subscription;
    });

    // Return a dummy subscription that will unsubscribe the actual one when ready
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            if (actualSubscription) {
              actualSubscription.unsubscribe();
            }
          }
        }
      }
    };
  }
}

export default getSupabaseClient
