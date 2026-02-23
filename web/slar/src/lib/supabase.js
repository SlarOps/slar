import { createClient } from '@supabase/supabase-js'
import { getConfigSync } from './config';

// Singleton instance
let supabaseInstance = null;

// Get config from runtime config
const getSupabaseConfig = () => {
  const config = getConfigSync();
  return {
    supabaseUrl: config.supabaseUrl || 'http://localhost:54321',
    supabaseAnonKey: config.supabaseAnonKey || '',
  };
};

// Get or create Supabase client (singleton pattern)
const getSupabaseClient = () => {
  // Return existing instance if already created
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const config = getSupabaseConfig();

  // Only create client if we have valid config
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.warn('⚠️ Supabase not configured. Storage features will be disabled.');
    return null;
  }

  console.log('✅ Creating Supabase client instance:', {
    url: config.supabaseUrl,
    hasAnonKey: !!config.supabaseAnonKey,
  });

  supabaseInstance = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'slar-auth-token',
    }
  });

  return supabaseInstance;
};

// For backward compatibility - lazy initialization
export const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase client not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }
    return client[prop];
  }
});

// Initialize supabase client (sync now)
export const initSupabase = () => {
  return getSupabaseClient();
};

// Auth helper functions (deprecated - use NextAuth instead)
// Kept for backward compatibility with storage features
export const auth = {
  // Sign in with email and password
  async signIn(email, password) {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: new Error('Supabase not configured') };
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    return { data, error };
  },

  // Sign up with email and password
  async signUp(email, password, metadata = {}) {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: new Error('Supabase not configured') };
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: metadata }
    });
    return { data, error };
  },

  // Sign out
  async signOut() {
    const client = getSupabaseClient();
    if (!client) return { error: null };
    const { error } = await client.auth.signOut();
    return { error };
  },

  // Get current user
  async getUser() {
    const client = getSupabaseClient();
    if (!client) return { user: null, error: null };
    const { data: { user }, error } = await client.auth.getUser();
    return { user, error };
  },

  // Get current session
  async getSession() {
    const client = getSupabaseClient();
    if (!client) return { session: null, error: null };
    const { data: { session }, error } = await client.auth.getSession();
    return { session, error };
  },

  // Subscribe to auth changes
  onAuthStateChange(callback) {
    const client = getSupabaseClient();
    if (!client) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
    return client.auth.onAuthStateChange(callback);
  }
};

export default getSupabaseClient
