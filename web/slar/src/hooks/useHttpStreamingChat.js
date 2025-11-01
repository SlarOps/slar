/**
 * HTTP Streaming Chat Hook - Compatible with existing UI
 * Replaces WebSocket with HTTP streaming but maintains same interface
 */

import { useState, useCallback, useRef, useEffect } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';

export function useHttpStreamingChat() {
  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null); // {approval_id, tool_name, tool_args}
  const abortControllerRef = useRef(null);

  // Load session ID from localStorage on mount
  useEffect(() => {
    const savedSessionId = localStorage.getItem('claude_session_id');
    if (savedSessionId) {
      setSessionId(savedSessionId);
    }
  }, []);

  // Save session ID to localStorage
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('claude_session_id', sessionId);
    }
  }, [sessionId]);

  const sendMessage = useCallback(async (message) => {
    if (isSending) return;

    try {
      setIsSending(true);
      setConnectionStatus('connected');

      // Add user message
      setMessages(prev => [...prev, {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }]);

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      // Prepare request
      const requestBody = {
        prompt: message,
        session_id: sessionId,
        permission_mode: 'acceptEdits',
        model: 'sonnet',
      };

      // Start streaming
      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = ''; // Track accumulated content locally
      let currentThought = null;

      // Add empty assistant message
      const assistantMessageIndex = messages.length + 1; // User message was just added
      setMessages(prev => [...prev, {
        role: 'assistant',
        source: 'assistant',
        content: '',
        type: 'TextMessageContentPartChunk',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      }]);

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data);

                // Handle thinking block
                if (event.type === 'thinking') {
                  currentThought = event.content;
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                      lastMsg.thought = event.content;
                      lastMsg.isStreaming = true;
                    }
                    return newMessages;
                  });
                }
                // Handle text block
                else if (event.type === 'text') {
                  accumulatedContent += event.content; // Accumulate locally first
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                      lastMsg.content = accumulatedContent; // Set to full accumulated content
                      lastMsg.isStreaming = true;
                      // Clear thought once we have actual content
                      if (accumulatedContent && lastMsg.thought) {
                        delete lastMsg.thought;
                      }
                    }
                    return newMessages;
                  });
                }
                // Handle tool approval request
                else if (event.type === 'tool_approval_request') {
                  setPendingApproval({
                    approval_id: event.approval_id,
                    tool_name: event.tool_name,
                    tool_args: event.tool_args
                  });
                }
                // Handle tool use (after approval)
                else if (event.type === 'tool_use') {
                  console.log('Tool executing:', event.tool_name, event.tool_args);
                  // Could add a message to show tool is executing
                }
                // Handle tool denied
                else if (event.type === 'tool_denied') {
                  console.log('Tool denied:', event.tool_name, event.reason);
                  // Could add a message to show tool was denied
                }
                // Handle tool result
                else if (event.type === 'tool_result') {
                  console.log('Tool result:', event.content);
                  // Could add tool result to messages
                }
                // Handle completion - turn off indicator and save session_id
                else if (event.type === 'complete') {
                  if (event.session_id) {
                    setSessionId(event.session_id);
                  }
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                      lastMsg.isStreaming = false;
                    }
                    return newMessages;
                  });
                }
                // Handle errors
                else if (event.type === 'error') {
                  throw new Error(event.error || 'Unknown error');
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', data, e);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      setConnectionStatus('disconnected');
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request aborted');
      } else {
        console.error('Chat error:', error);
        setConnectionStatus('error');

        // Add error message
        setMessages(prev => [...prev, {
          role: 'assistant',
          source: 'system',
          content: `Error: ${error.message}`,
          type: 'error',
          timestamp: new Date().toISOString(),
        }]);
      }
    } finally {
      setIsSending(false);
      abortControllerRef.current = null;
    }
  }, [isSending, sessionId]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSending(false);

    // Mark last message as not streaming
    setMessages(prev => {
      const newMessages = [...prev];
      const lastMsg = newMessages[newMessages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.isStreaming = false;
      }
      return newMessages;
    });
  }, []);

  const resetSession = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    localStorage.removeItem('claude_session_id');
    setConnectionStatus('disconnected');
    return null; // Return null as new session ID (will be created on next message)
  }, []);

  const approveTool = useCallback(async (approvalId, reason) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, reason })
      });

      if (!response.ok) {
        throw new Error(`Failed to approve tool: ${response.status}`);
      }

      setPendingApproval(null);
    } catch (error) {
      console.error('Error approving tool:', error);
    }
  }, []);

  const denyTool = useCallback(async (approvalId, reason) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false, reason })
      });

      if (!response.ok) {
        throw new Error(`Failed to deny tool: ${response.status}`);
      }

      setPendingApproval(null);
    } catch (error) {
      console.error('Error denying tool:', error);
    }
  }, []);

  return {
    messages,
    setMessages,
    connectionStatus,
    isSending,
    sendMessage,
    stopStreaming,
    sessionId,
    resetSession,
    pendingApproval,
    approveTool,
    denyTool,
  };
}
