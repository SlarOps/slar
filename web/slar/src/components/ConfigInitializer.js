'use client';

import { useEffect } from 'react';
import { initConfig } from '../lib/config';

/**
 * ConfigInitializer - Fetches runtime config early in the app lifecycle
 * 
 * Place this component high in your component tree to ensure config
 * is loaded before other components try to use it.
 */
export default function ConfigInitializer({ children }) {
  useEffect(() => {
    // Initialize config on mount (fetches from /api/config)
    initConfig();
  }, []);

  return children;
}
