'use client';

import { useEffect } from 'react';

// This component injects runtime environment variables into window.__SLAR_ENV
// It runs on the client side to ensure the variables are available before any other code
export default function RuntimeEnvScript() {
  useEffect(() => {
    // Check if __SLAR_ENV is already set (from server-side injection)
    if (!window.__SLAR_ENV) {
      console.warn('window.__SLAR_ENV not found. Using fallback values.');
      window.__SLAR_ENV = {
        NEXT_PUBLIC_SUPABASE_URL: '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      };
    }
  }, []);

  return null;
}

