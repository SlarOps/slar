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

const HOST = window.location.host;
const PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_AI_WS_URL || `${PROTOCOL}://${HOST}/ws/chat`;

/**
 * Claude WebSocket Hook Options
 * @typedef {Object} WebSocketOptions
 * @property {boolean} autoConnect - Whether to connect automatically on mount (default: false)
 */

/**
 * @param {string|null} authToken - Authentication token
 * @param {WebSocketOptions} options - Configuration options
 */
export function useClaudeWebSocket(authToken = null, options = {}) {
  const { autoConnect = false } = options;

  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;
  const streamingTimeoutRef = useRef(null);
  const streamingInactivityTimeout = 2000; // 2 seconds of inactivity marks message as complete
  const authTokenRef = useRef(authToken); // Store token in ref for WebSocket access

  // Update auth token ref when it changes
  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  // Load session ID from localStorage on mount
  useEffect(() => {
    const savedSessionId = localStorage.getItem('claude_session_id');
    if (savedSessionId) {
      setSessionId(savedSessionId);
      console.log('Restored session ID:', savedSessionId);
    }
  }, []);

  // Save session ID to localStorage
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('claude_session_id', sessionId);
      console.log('Saved session ID:', sessionId);
    }
  }, [sessionId]);

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
      console.log('Connecting to WebSocket:', DEFAULT_WS_URL);
      setConnectionStatus('connecting');

      const ws = new WebSocket(DEFAULT_WS_URL);
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
          console.log('WebSocket JSON message:', data);

          // Handle different message types from Claude Agent API
          switch (data.type) {
            case 'connected':
              console.log('Connection established:', data.connection_id);
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
              // Session initialized
              setSessionId(data.session_id);
              console.log('Session initialized:', data.session_id);
              break;

            case 'processing':
              console.log('Processing started:', data.content);
              break;

            case 'thinking':
              // Agent thinking - update last message with thought
              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  return [...prev.slice(0, -1), {
                    ...lastMsg,
                    thought: data.content,
                    isStreaming: true
                  }];
                }
                // No assistant message yet, create one
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
              // Text content - append to last message
              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
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
              console.log('Tool result:', data.content);
              // Add tool result message
              setMessages(prev => [...prev, {
                role: 'assistant',
                source: 'assistant',
                content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content, null, 2),
                type: 'tool_result',
                timestamp: new Date().toISOString()
              }]);
              break;

            case 'permission_request':
              // Tool approval request
              console.log('Tool approval requested:', data.tool_name);
              const approvalId = data.approval_id || Date.now();
              setPendingApproval({
                approval_id: approvalId,
                tool_name: data.tool_name,
                tool_input: data.input_data || data.tool_input,
                suggestions: data.suggestions || []
              });
              // Add approval request message with all necessary data
              setMessages(prev => [...prev, {
                role: 'assistant',
                source: 'assistant',
                content: '',
                type: 'permission_request',
                approval_id: approvalId,
                tool_name: data.tool_name,
                tool_input: data.input_data || data.tool_input,
                timestamp: new Date().toISOString()
              }]);
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
              // Query completed
              console.log('Query completed');
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

            default:
              console.log('Unknown message type:', data.type);
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
          setIsSending(false);
        }
      };

      ws.onerror = (error) => {
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
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setConnectionStatus('disconnected');
  }, []);

  // Send message
  const sendMessage = useCallback((message, options = {}) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      connect();
      return;
    }

    if (isSending) {
      console.warn('Already sending a message');
      return;
    }

    try {
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
      const wsMessage = {
        prompt: message,
        session_id: sessionId || "",
        auth_token: authTokenRef.current || ""
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
  }, [sessionId, isSending, connect]);

  // Approve tool
  const approveTool = useCallback((approvalId, reason = 'Approved by user') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    try {
      // Claude Agent API v1 expects { allow: "yes" } or { allow: "y" }
      wsRef.current.send(JSON.stringify({
        allow: 'yes'
      }));

      // Mark the message as approved
      setMessages(prev => prev.map(msg =>
        msg.approval_id === approvalId
          ? { ...msg, approved: true, denied: false }
          : msg
      ));

      setPendingApproval(null);
      console.log('Tool approved:', approvalId, reason);
    } catch (error) {
      console.error('Error approving tool:', error);
    }
  }, []);

  // Deny tool
  const denyTool = useCallback((approvalId, reason = 'Denied by user') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    try {
      // Claude Agent API v1 expects { allow: "no" } or any non-yes value
      wsRef.current.send(JSON.stringify({
        allow: 'no'
      }));

      // Mark the message as denied
      setMessages(prev => prev.map(msg =>
        msg.approval_id === approvalId
          ? { ...msg, approved: false, denied: true }
          : msg
      ));

      setPendingApproval(null);
      console.log('Tool denied:', approvalId, reason);
    } catch (error) {
      console.error('Error denying tool:', error);
    }
  }, []);

  // Reset session
  const resetSession = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    localStorage.removeItem('claude_session_id');
    console.log('Session reset');
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
    resetSession,
    pendingApproval,
    approveTool,
    denyTool,
    connect,
    disconnect
  };
}
