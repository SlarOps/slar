/**
 * Claude WebSocket Hook - Connects to api/ai/claude_agent_api.py
 *
 * Features:
 * - WebSocket connection with automatic reconnection
 * - Heartbeat (ping/pong) support
 * - Tool approval system (interactive, rule_based, hybrid)
 * - Session management with localStorage
 * - Message streaming from Claude Agent SDK
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import apiClient from '../lib/api';

const HOST = window.location.host;
const PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_AI_WS_URL || `${PROTOCOL}://${HOST}/ws/chat`;

/**
 * Claude WebSocket Hook Options
 * @typedef {Object} WebSocketOptions
 * @property {boolean} autoConnect - Whether to connect automatically on mount (default: false)
 * @property {string} orgId - Organization ID for audit logging
 * @property {string} projectId - Project ID for audit logging
 */

/**
 * @param {string|null} authToken - Authentication token
 * @param {WebSocketOptions} options - Configuration options
 */
export function useClaudeWebSocket(authToken = null, options = {}) {
  const { autoConnect = false, orgId = null, projectId = null } = options;

  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [conversationId, setConversationId] = useState(null); // Claude conversation ID for resume
  const [pendingApprovals, setPendingApprovals] = useState([]); // Changed to array for multiple approvals
  const [todos, setTodos] = useState([]);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;
  const streamingTimeoutRef = useRef(null);
  const streamingInactivityTimeout = 2000; // 2 seconds of inactivity marks message as complete
  const authTokenRef = useRef(authToken); // Store token in ref for WebSocket access
  const orgIdRef = useRef(orgId); // Store org_id in ref for WebSocket access
  const projectIdRef = useRef(projectId); // Store project_id in ref for WebSocket access
  const isIntentionalDisconnect = useRef(false); // Track intentional disconnects

  // Update refs when values change
  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  useEffect(() => {
    orgIdRef.current = orgId;
  }, [orgId]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Load session ID and conversation ID from localStorage on mount
  useEffect(() => {
    const savedSessionId = localStorage.getItem('claude_session_id');
    const savedConversationId = localStorage.getItem('claude_conversation_id');
    if (savedSessionId) {
      setSessionId(savedSessionId);
      console.log('Restored session ID:', savedSessionId);
    }
    if (savedConversationId) {
      setConversationId(savedConversationId);
      console.log('Restored conversation ID:', savedConversationId);
    }
  }, []);

  // Save session ID to localStorage
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('claude_session_id', sessionId);
      console.log('Saved session ID:', sessionId);
    }
  }, [sessionId]);

  // Save conversation ID to localStorage
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem('claude_conversation_id', conversationId);
      console.log('Saved conversation ID:', conversationId);
    }
  }, [conversationId]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Prevent duplicate connections - check all active states
    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN) {
        console.log('WebSocket already connected');
        return;
      }
      if (state === WebSocket.CONNECTING) {
        console.log('WebSocket already connecting...');
        return;
      }
    }

    try {
      // Build WebSocket URL with token, org_id, and project_id for authentication and audit
      const token = authTokenRef.current;
      const currentOrgId = orgIdRef.current;
      const currentProjectId = projectIdRef.current;

      // Build query params
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      if (currentOrgId) params.append('org_id', currentOrgId);
      if (currentProjectId) params.append('project_id', currentProjectId);

      const queryString = params.toString();
      const wsUrl = queryString ? `${DEFAULT_WS_URL}?${queryString}` : DEFAULT_WS_URL;

      console.log('Connecting to WebSocket:', DEFAULT_WS_URL, {
        hasToken: !!token,
        orgId: currentOrgId || 'none',
        projectId: currentProjectId || 'none'
      });
      setConnectionStatus('connecting');
      isIntentionalDisconnect.current = false;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          // Try to parse as JSON first
          let data;
          let isJson = true;

          try {
            data = JSON.parse(event.data);
          } catch (e) {
            // Not JSON, treat as plain text streaming from Claude
            isJson = false;
          }

          // Handle plain text messages (streaming from Claude Agent SDK)
          if (!isJson) {
            const textContent = event.data;
            console.log('WebSocket text message:', textContent.substring(0, 50) + '...');

            setMessages(prev => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                // Append to existing streaming message
                return [...prev.slice(0, -1), {
                  ...lastMsg,
                  content: (lastMsg.content || '') + textContent,
                  isStreaming: true
                }];
              }
              // Create new assistant message
              return [...prev, {
                role: 'assistant',
                source: 'assistant',
                content: textContent,
                type: 'text',
                timestamp: new Date().toISOString(),
                isStreaming: true
              }];
            });

            // Reset streaming timeout - mark as complete after inactivity
            if (streamingTimeoutRef.current) {
              clearTimeout(streamingTimeoutRef.current);
            }
            streamingTimeoutRef.current = setTimeout(() => {
              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                  console.log('Marking message as complete after inactivity');
                  setIsSending(false);
                  return [...prev.slice(0, -1), {
                    ...lastMsg,
                    isStreaming: false
                  }];
                }
                return prev;
              });
            }, streamingInactivityTimeout);

            return;
          }

          // Handle JSON messages

          // Handle different message types from Claude Agent API
          switch (data.type) {
            case 'connected':
              console.log('Connection established:', data.connection_id);
              break;

            case 'session_created':
              // Session created IMMEDIATELY after WebSocket connects
              // This provides session_id for interrupts before Claude starts responding
              setSessionId(data.session_id);
              console.log('Session created (for interrupts):', data.session_id);
              break;

            case 'ping':
              // Respond to heartbeat ping
              try {
                const pongMessage = JSON.stringify({
                  type: 'pong',
                  timestamp: data.timestamp
                });
                ws.send(pongMessage);
                console.log('[HEARTBEAT] Pong sent, roundtrip:', Date.now() - (data.timestamp * 1000), 'ms');
              } catch (error) {
                console.error('[HEARTBEAT] Failed to send pong:', error);
              }
              break;

            case 'session_init':
              // Session initialized - extract both session_id and conversation_id
              setSessionId(data.session_id);
              if (data.conversation_id) {
                setConversationId(data.conversation_id);
                console.log('Session initialized:', data.session_id, 'Conversation ID:', data.conversation_id);
              } else {
                console.log('Session initialized:', data.session_id);
              }
              break;

            case 'conversation_started':
              // Claude conversation started - store conversation_id for resume
              // NOTE: This is separate from session_id (used for interrupts)
              if (data.conversation_id) {
                setConversationId(data.conversation_id);
                console.log('Conversation started:', data.conversation_id);
              }
              break;

            case 'processing':
              console.log('Processing started:', data.content);
              break;

            case 'thinking':
              // Agent thinking - update last text message OR create new
              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                // Only update if last message is text or thinking type
                // Don't update tool_result, tool_use, or permission_request
                const canUpdate = lastMsg &&
                  lastMsg.role === 'assistant' &&
                  (lastMsg.type === 'text' || lastMsg.type === 'thinking' || !lastMsg.type);

                if (canUpdate) {
                  return [...prev.slice(0, -1), {
                    ...lastMsg,
                    thought: data.content,
                    isStreaming: true
                  }];
                }
                // Create new thinking message
                return [...prev, {
                  role: 'assistant',
                  source: 'assistant',
                  content: '',
                  thought: data.content,
                  type: 'thinking',
                  timestamp: new Date().toISOString(),
                  isStreaming: true
                }];
              });
              break;

            case 'text':
              // Text content - append to last message OR create new
              // Skip empty text
              if (!data.content) break;

              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                // Only append if last message is assistant, streaming, AND is text/thinking type
                // Don't append to tool_result or tool_use messages
                const canAppend = lastMsg &&
                  lastMsg.role === 'assistant' &&
                  lastMsg.isStreaming &&
                  (lastMsg.type === 'text' || lastMsg.type === 'thinking');

                if (canAppend) {
                  return [...prev.slice(0, -1), {
                    ...lastMsg,
                    content: (lastMsg.content || '') + data.content,
                    thought: undefined, // Clear thought when we have actual content
                    type: 'text',
                    isStreaming: true
                  }];
                }
                // Create new assistant message
                return [...prev, {
                  role: 'assistant',
                  source: 'assistant',
                  content: data.content,
                  type: 'text',
                  timestamp: new Date().toISOString(),
                  isStreaming: true
                }];
              });
              break;

            case 'tool_use':
              console.log('Tool executing:', data.content);
              // Add tool use message
              setMessages(prev => [...prev, {
                role: 'assistant',
                source: 'assistant',
                content: JSON.stringify(data.content, null, 2),
                type: 'tool_use',
                timestamp: new Date().toISOString()
              }]);
              break;

            case 'tool_result':
              // Add tool result message (NOT streaming - this is a complete result)
              setMessages(prev => [...prev, {
                role: 'assistant',
                source: 'assistant',
                content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content, null, 2),
                type: 'tool_result',
                timestamp: new Date().toISOString(),
                isStreaming: false  // Tool results are complete, not streaming
              }]);
              break;


            case 'permission_request':
              // Tool approval request - agent is waiting for user input
              console.log('Tool approval requested:', data.tool_name);
              const requestId = data.request_id || Date.now(); // Backend sends request_id
              const newApproval = {
                request_id: requestId, // Use request_id to match backend
                tool_name: data.tool_name,
                tool_input: data.input_data || data.tool_input,
                suggestions: data.suggestions || []
              };

              // Add to pending approvals array (support multiple concurrent requests)
              setPendingApprovals(prev => [...prev, newApproval]);

              // Add approval request message with all necessary data
              setMessages(prev => [...prev, {
                role: 'assistant',
                source: 'assistant',
                content: '',
                type: 'permission_request',
                request_id: requestId, // Use request_id for consistency
                tool_name: data.tool_name,
                tool_input: data.input_data || data.tool_input,
                timestamp: new Date().toISOString()
              }]);

              // Allow user to interact while waiting for approval
              // (agent is blocked waiting for permission, not processing)
              setIsSending(false);
              break;

            case 'interrupt_acknowledged':
              console.log('Interrupt acknowledged:', data.session_id);
              break;

            case 'interrupted':
              console.log('Agent interrupted:', data.session_id);
              setMessages(prev => [...prev, {
                role: 'assistant',
                source: 'system',
                content: 'Task interrupted by user',
                type: 'interrupted',
                timestamp: new Date().toISOString()
              }]);
              setIsSending(false);
              break;

            case 'complete':
            case 'success':
              // Query completed - mark all streaming messages as complete
              setMessages(prev => prev.map(msg =>
                msg.isStreaming ? { ...msg, isStreaming: false } : msg
              ));
              setIsSending(false);
              break;

            case 'error':
              console.error('WebSocket error message:', data.error);
              setMessages(prev => [...prev, {
                role: 'assistant',
                source: 'system',
                content: `Error: ${data.error}`,
                type: 'error',
                timestamp: new Date().toISOString()
              }]);
              setIsSending(false);
              setConnectionStatus('error');
              break;

            case 'todo_update':
              // Todo list update from TodoWrite tool
              console.log('Todo list updated:', data.todos);
              setTodos(data.todos || []);
              break;

            default:
              console.log('Unknown message type:', data.type);
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
          setIsSending(false);
        }
      };

      ws.onerror = (error) => {
        // Don't log error if it's an intentional disconnect
        if (isIntentionalDisconnect.current) {
          console.log('[WS] Suppressing error for intentional disconnect');
          return;
        }
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
      };

      ws.onclose = (event) => {
        const closeReasons = {
          1000: 'Normal closure',
          1001: 'Going away (server shutdown or browser navigation)',
          1002: 'Protocol error',
          1003: 'Unsupported data',
          1006: 'Abnormal closure (no close frame)',
          1007: 'Invalid frame payload data',
          1008: 'Policy violation',
          1009: 'Message too big',
          1010: 'Mandatory extension missing',
          1011: 'Internal server error',
          1015: 'TLS handshake failure'
        };

        const reason = closeReasons[event.code] || 'Unknown reason';
        console.log(`[WS] Connection closed: ${event.code} - ${reason}`, event.reason || '');
        setConnectionStatus('disconnected');
        wsRef.current = null;
        setIsSending(false);

        // Check if this was an intentional disconnect (e.g. React Strict Mode unmount)
        if (isIntentionalDisconnect.current) {
          console.log('[WS] Intentional disconnect, not reconnecting');
          return;
        }

        // Auto-reconnect if not a normal closure and haven't exceeded max attempts
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          console.log(`[WS] Reconnecting... Attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts} (delay: ${reconnectDelay}ms)`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectDelay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.error('[WS] Max reconnection attempts reached');
          setMessages(prev => [...prev, {
            role: 'assistant',
            source: 'system',
            content: 'Connection lost. Please refresh the page.',
            type: 'error',
            timestamp: new Date().toISOString()
          }]);
        } else if (event.code === 1000) {
          console.log('[WS] Clean disconnect, not reconnecting');
        }
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setConnectionStatus('error');
    }
  }, []);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      isIntentionalDisconnect.current = true; // Mark as intentional
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setConnectionStatus('disconnected');
  }, []);

  // Send message - messages are queued on backend, no blocking needed
  const sendMessage = useCallback((message, options = {}) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      connect();
      return;
    }

    try {
      // Set sending state for UI feedback (but don't block)
      setIsSending(true);

      // Mark previous streaming message as complete before adding new user message
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
          const completedMsg = [...prev.slice(0, -1), {
            ...lastMsg,
            isStreaming: false
          }];
          // Add user message
          return [...completedMsg, {
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
          }];
        }
        // No streaming message, just add user message
        return [...prev, {
          role: 'user',
          content: message,
          timestamp: new Date().toISOString()
        }];
      });

      // Prepare WebSocket message (Claude Agent API v1 format)
      // conversation_id is used for Claude SDK resume functionality
      const wsMessage = {
        prompt: message,
        session_id: sessionId || "",
        conversation_id: options.conversationId || conversationId || "",
        auth_token: authTokenRef.current || "",
        org_id: options.orgId || "",
        project_id: options.projectId || ""
      };

      console.log('Sending message:', { ...wsMessage, auth_token: authTokenRef.current ? '***' : '' });
      wsRef.current.send(JSON.stringify(wsMessage));

    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        source: 'system',
        content: `Error sending message: ${error.message}`,
        type: 'error',
        timestamp: new Date().toISOString()
      }]);
    }
  }, [sessionId, conversationId, connect]);

  // Approve tool
  const approveTool = useCallback((requestId, reason = 'Approved by user') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    try {
      // Send approval with request_id so SDK knows which request to approve
      wsRef.current.send(JSON.stringify({
        type: 'permission_response',
        request_id: requestId, // Use request_id to match backend
        allow: 'yes'
      }));

      // Agent will continue processing after approval
      setIsSending(true);

      // Mark the message as approved
      setMessages(prev => prev.map(msg =>
        msg.request_id === requestId
          ? { ...msg, approved: true, denied: false }
          : msg
      ));

      // Remove from pending approvals array
      setPendingApprovals(prev => prev.filter(a => a.request_id !== requestId));

      console.log('Tool approved:', requestId, reason);
    } catch (error) {
      console.error('Error approving tool:', error);
    }
  }, []);

  // Approve tool always - saves permission pattern like "Bash(kubectl get:*)"
  const approveToolAlways = useCallback(async (requestId, permissionPattern) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    try {
      // 1. Save permission pattern to backend (e.g., "Bash(kubectl get:*)")
      if (authTokenRef.current && permissionPattern) {
        try {
          // Set token for API client if not already set
          if (!apiClient.token) {
            apiClient.setToken(authTokenRef.current);
          }

          await apiClient.addAllowedTool(permissionPattern);
          console.log('Permission pattern added to allowed list:', permissionPattern);
        } catch (err) {
          console.error('Failed to save allowed tool preference:', err);
          // Continue to approve anyway
        }
      }

      // 2. Approve current request
      approveTool(requestId, 'Approved always by user');

    } catch (error) {
      console.error('Error approving tool always:', error);
    }
  }, [approveTool]);

  // Deny tool
  const denyTool = useCallback((requestId, reason = 'Denied by user') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    try {
      // Send denial with request_id so SDK knows which request to deny
      wsRef.current.send(JSON.stringify({
        type: 'permission_response',
        request_id: requestId, // Use request_id to match backend
        allow: 'no'
      }));

      // Agent will continue processing (may try different approach or complete)
      setIsSending(true);

      // Mark the message as denied
      setMessages(prev => prev.map(msg =>
        msg.request_id === requestId
          ? { ...msg, approved: false, denied: true }
          : msg
      ));

      // Remove from pending approvals array
      setPendingApprovals(prev => prev.filter(a => a.request_id !== requestId));

      console.log('Tool denied:', requestId, reason);
    } catch (error) {
      console.error('Error denying tool:', error);
    }
  }, []);

  // Reset session and conversation completely
  const resetSession = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setConversationId(null);
    localStorage.removeItem('claude_session_id');
    localStorage.removeItem('claude_conversation_id');
    console.log('Session and conversation reset');
  }, []);

  // Start a new conversation (keeps WebSocket session, clears conversation)
  const newConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setTodos([]);
    localStorage.removeItem('claude_conversation_id');
    console.log('Started new conversation');
  }, []);

  // Resume an existing conversation by ID and load previous messages
  const resumeConversation = useCallback(async (convId) => {
    setMessages([]);
    setConversationId(convId);
    setTodos([]);
    localStorage.setItem('claude_conversation_id', convId);
    console.log('Resuming conversation:', convId);

    // Load previous messages from API
    try {
      if (authTokenRef.current) {
        // Set token for API client if not already set
        if (!apiClient.token) {
          apiClient.setToken(authTokenRef.current);
        }

        const response = await apiClient.getConversationMessages(convId);
        if (response.success && response.messages) {
          // Convert DB messages to UI format
          const loadedMessages = response.messages.map(msg => ({
            role: msg.role,
            content: msg.content || '',
            type: msg.message_type || 'text',
            timestamp: msg.created_at,
            isStreaming: false,
            isHistory: true  // Mark as history so UI can style differently if needed
          }));
          setMessages(loadedMessages);
          console.log('Loaded', loadedMessages.length, 'messages from history');
        }
      }
    } catch (err) {
      console.error('Failed to load conversation messages:', err);
      // Continue anyway - user can still send new messages
    }
  }, []);

  // Send interrupt request
  const sendInterrupt = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    if (!sessionId) {
      console.error('No session ID available');
      return;
    }

    try {
      console.log('Sending interrupt request for session:', sessionId);
      wsRef.current.send(JSON.stringify({
        type: 'interrupt',
        session_id: sessionId
      }));
    } catch (error) {
      console.error('Error sending interrupt:', error);
    }
  }, [sessionId]);

  // Stop streaming (using interrupt)
  const stopStreaming = useCallback(() => {
    if (isSending) {
      // Send interrupt request
      sendInterrupt();

      // Mark last message as not streaming
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          return [...prev.slice(0, -1), {
            ...lastMsg,
            isStreaming: false
          }];
        }
        return prev;
      });
    }
  }, [isSending, sendInterrupt]);

  // Auto-connect on mount (only once) - if enabled
  useEffect(() => {
    // Skip if autoConnect is disabled
    if (!autoConnect) {
      console.log('[WS] Auto-connect disabled, call connect() manually');
      return;
    }

    // Check if already connected or connecting to prevent Strict Mode double-connection
    if (wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)) {
      console.log('Skipping duplicate connection in Strict Mode');
      return;
    }

    console.log('[WS] Auto-connecting on mount');
    connect();

    return () => {
      // Clean up timeouts
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
      }
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]); // Re-run if autoConnect changes

  return {
    messages,
    setMessages,
    connectionStatus,
    isSending,
    sendMessage,
    stopStreaming,
    sendInterrupt,
    sessionId,
    conversationId,
    resetSession,
    newConversation,
    resumeConversation,
    pendingApprovals, // Changed from pendingApproval to array
    approveTool,
    approveToolAlways,
    denyTool,
    todos,
    connect,
    disconnect
  };
}
