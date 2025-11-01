/**
 * Hook for managing Claude Agent sessions
 */

import { useState, useEffect, useCallback } from 'react';
import { claudeAgentService } from '@/services/claude-agent';
import type { SessionInfo } from '@/types/claude-agent';

export function useSessionManager() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedSessions = await claudeAgentService.listSessions();
      setSessions(loadedSessions);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load sessions'));
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const getSession = useCallback(async (sessionId: string): Promise<SessionInfo | null> => {
    try {
      return await claudeAgentService.getSessionInfo(sessionId);
    } catch (err) {
      console.error('Failed to get session:', err);
      return null;
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await claudeAgentService.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));

      // Clear from localStorage if it's the current session
      const currentSessionId = localStorage.getItem('claude_session_id');
      if (currentSessionId === sessionId) {
        localStorage.removeItem('claude_session_id');
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      throw err;
    }
  }, []);

  const getCurrentSessionId = useCallback((): string | null => {
    return localStorage.getItem('claude_session_id');
  }, []);

  const setCurrentSessionId = useCallback((sessionId: string | null) => {
    if (sessionId) {
      localStorage.setItem('claude_session_id', sessionId);
    } else {
      localStorage.removeItem('claude_session_id');
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return {
    sessions,
    loading,
    error,
    loadSessions,
    getSession,
    deleteSession,
    getCurrentSessionId,
    setCurrentSessionId,
  };
}
