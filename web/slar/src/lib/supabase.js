import { createClient } from '@supabase/supabase-js'

// Get runtime environment variables from window.__SLAR_ENV
// This allows building once and changing env vars at runtime (e.g., in Docker)
// The server.js will inject these values from process.env at runtime
const getRuntimeEnv = () => {
  if (typeof window !== 'undefined' && window.__SLAR_ENV) {
    return window.__SLAR_ENV;
  }
  // Fallback for SSR or when __SLAR_ENV is not available
  return {};
};

const runtimeEnv = getRuntimeEnv();
const supabaseUrl = runtimeEnv.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:8000';
const supabaseAnonKey = runtimeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || '1234567890';

// Log configuration for debugging
if (typeof window !== 'undefined') {
  console.log('Supabase Configuration:', {
    url: supabaseUrl,
    hasAnonKey: !!supabaseAnonKey,
    anonKeyLength: supabaseAnonKey?.length,
    source: window.__SLAR_ENV ? 'runtime' : 'fallback'
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

// Auth helper functions
export const auth = {
  // Sign in with email and password
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  },

  // Sign up with email and password
  async signUp(email, password, metadata = {}) {
    const { data, error } = await supabase.auth.signUp({
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
    const { error } = await supabase.auth.signOut()
    return { error }
  },

  // Get current user
  async getUser() {
    const { data: { user }, error } = await supabase.auth.getUser()
    return { user, error }
  },

  // Get current session
  async getSession() {
    const { data: { session }, error } = await supabase.auth.getSession()
    return { session, error }
  },

  // Reset password
  async resetPassword(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    })
    return { data, error }
  },

  // Update user password
  async updatePassword(password) {
    const { data, error } = await supabase.auth.updateUser({
      password: password
    })
    return { data, error }
  },

  // Subscribe to auth changes
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback)
  }
}

export default supabase
