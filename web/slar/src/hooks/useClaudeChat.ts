/**
 * Hook for Claude Agent chat with HTTP streaming
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { claudeAgentService } from '@/services/claude-agent';
import type { ChatMessage, ChatRequest, StreamEvent } from '@/types/claude-agent';
import { v4 as uuidv4 } from 'uuid';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';

export interface UseClaudeChatOptions {
  autoSaveSession?: boolean;
  onSessionIdChange?: (sessionId: string) => void;
  onError?: (error: Error) => void;
}

export function useClaudeChat(options: UseClaudeChatOptions = {}) {
  const { autoSaveSession = true, onSessionIdChange, onError } = options;

  // Get organization and auth context for ReBAC tenant isolation
  const { currentOrg, currentProject } = useOrg();
  const { session } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageRef = useRef<ChatMessage | null>(null);

  // Save session ID to localStorage
  useEffect(() => {
    if (autoSaveSession && sessionId) {
      localStorage.setItem('claude_session_id', sessionId);
      onSessionIdChange?.(sessionId);
    }
  }, [sessionId, autoSaveSession, onSessionIdChange]);

  // Load session ID from localStorage on mount
  useEffect(() => {
    if (autoSaveSession) {
      const savedSessionId = localStorage.getItem('claude_session_id');
      if (savedSessionId) {
        setSessionId(savedSessionId);
      }
    }
  }, [autoSaveSession]);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateLastMessage = useCallback((content: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === 'assistant') {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + content }
        ];
      }
      return prev;
    });
  }, []);

  const sendMessage = useCallback(async (
    prompt: string,
    options: Partial<ChatRequest> = {}
  ) => {
    if (isStreaming) {
      console.warn('Already streaming, ignoring new message');
      return;
    }

    try {
      setIsStreaming(true);
      setConnectionStatus('connected');

      // Add user message
      const userMessage: ChatMessage = {
        id: uuidv4(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      addMessage(userMessage);

      // Create assistant message placeholder
      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        type: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      currentMessageRef.current = assistantMessage;
      addMessage(assistantMessage);

      // Prepare request with ReBAC tenant isolation
      const request: ChatRequest = {
        prompt,
        session_id: sessionId,
        org_id: currentOrg?.id,  // ReBAC: Required for tenant isolation
        project_id: currentProject?.id,  // ReBAC: Optional project filtering
        auth_token: session?.access_token ? `Bearer ${session.access_token}` : undefined,  // JWT for API calls
        ...options,
      };

      // Stream response
      let accumulatedContent = '';
      for await (const event of claudeAgentService.streamChat(request)) {
        if (event.type === 'session_id' && event.session_id) {
          setSessionId(event.session_id);
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Unknown error');
        } else if (event.type === 'complete') {
          // Streaming complete
          setConnectionStatus('disconnected');
        } else if (event.content) {
          // Accumulate content
          accumulatedContent += event.content;

          // Update the last message with accumulated content
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.id === assistantMessage.id) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: accumulatedContent }
              ];
            }
            return prev;
          });
        }
      }

    } catch (error) {
      console.error('Chat error:', error);
      setConnectionStatus('error');

      // Add error message
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        type: 'error',
        content: error instanceof Error ? error.message : 'An error occurred',
        timestamp: Date.now(),
      };
      addMessage(errorMessage);

      onError?.(error instanceof Error ? error : new Error('Unknown error'));
    } finally {
      setIsStreaming(false);
      currentMessageRef.current = null;
    }
  }, [isStreaming, sessionId, addMessage, onError, currentOrg?.id, currentProject?.id, session?.access_token]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setConnectionStatus('disconnected');
  }, []);

  const resetSession = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    localStorage.removeItem('claude_session_id');
    setConnectionStatus('disconnected');
  }, []);

  const loadSession = useCallback(async (sessionIdToLoad: string) => {
    try {
      const sessionInfo = await claudeAgentService.getSessionInfo(sessionIdToLoad);
      setSessionId(sessionInfo.session_id);

      // Convert session messages to ChatMessage format
      if (sessionInfo.messages) {
        const loadedMessages: ChatMessage[] = sessionInfo.messages.map((msg: any, idx: number) => ({
          id: uuidv4(),
          type: msg.type || 'assistant',
          content: msg.content || msg.raw || '',
          timestamp: Date.now() - (sessionInfo.messages!.length - idx) * 1000,
          raw: msg.raw,
        }));
        setMessages(loadedMessages);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      onError?.(error instanceof Error ? error : new Error('Failed to load session'));
    }
  }, [onError]);

  return {
    messages,
    sessionId,
    isStreaming,
    connectionStatus,
    sendMessage,
    stopStreaming,
    resetSession,
    loadSession,
  };
}
