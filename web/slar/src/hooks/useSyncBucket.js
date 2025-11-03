/**
 * useSyncBucket Hook - Syncs Supabase Storage bucket before WebSocket connection
 *
 * This hook implements the "Sync Before Connect" pattern to ensure all skills
 * and MCP configs are ready before the AI agent starts.
 *
 * Usage:
 *   const { syncStatus, syncMessage, syncBucket, retrySync } = useSyncBucket(authToken);
 *
 *   useEffect(() => {
 *     if (syncStatus === 'ready') {
 *       // Connect WebSocket now
 *     }
 *   }, [syncStatus]);
 */

import { useState, useCallback } from 'react';

const DEFAULT_AI_API_URL = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';

export function useSyncBucket(authToken) {
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'ready' | 'error'
  const [syncMessage, setSyncMessage] = useState('');
  const [syncResult, setSyncResult] = useState(null);

  /**
   * Sync bucket with backend
   */
  const syncBucket = useCallback(async () => {
    if (!authToken) {
      setSyncStatus('error');
      setSyncMessage('Authentication required');
      return false;
    }

    try {
      setSyncStatus('syncing');
      setSyncMessage('Loading your workspace...');

      const startTime = performance.now();

      const response = await fetch(`${DEFAULT_AI_API_URL}/api/sync-bucket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_token: authToken
        }),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expired. Please login again.');
        }
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      const duration = performance.now() - startTime;

      // Log performance metrics
      console.log(`Bucket sync completed in ${duration.toFixed(0)}ms`, result);

      if (result.success) {
        setSyncResult(result);
        setSyncStatus('ready');

        // Set appropriate message based on result
        if (result.skipped) {
          setSyncMessage('Workspace ready');
        } else {
          const skillCount = result.skills_synced || 0;
          const mcpSynced = result.mcp_synced ? 'MCP config + ' : '';
          setSyncMessage(`Loaded ${mcpSynced}${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
        }

        // Warn if slow sync
        if (duration > 5000) {
          console.warn(`Slow sync detected: ${duration}ms`);
        }

        return true;
      } else {
        throw new Error(result.message || 'Sync failed');
      }
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('error');

      // Set user-friendly error message
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        setSyncMessage('Request timeout. Please check your connection.');
      } else if (error.message.includes('Session expired')) {
        setSyncMessage(error.message);
      } else if (error.message.includes('Failed to fetch')) {
        setSyncMessage('Cannot connect to AI service. Please check if the service is running.');
      } else {
        setSyncMessage(error.message || 'Failed to load workspace');
      }

      return false;
    }
  }, [authToken]);

  /**
   * Retry sync (useful for error recovery)
   */
  const retrySync = useCallback(() => {
    syncBucket();
  }, [syncBucket]);

  /**
   * Reset sync state
   */
  const resetSync = useCallback(() => {
    setSyncStatus('idle');
    setSyncMessage('');
    setSyncResult(null);
  }, []);

  return {
    syncStatus,
    syncMessage,
    syncResult,
    syncBucket,
    retrySync,
    resetSync
  };
}
