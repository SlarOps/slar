import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

export const useWebSocket = (session, setMessages, setIsSending) => {
  const [wsConnection, setWsConnection] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [sessionId, setSessionId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    const connectWebSocket = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";

      // Generate or get session ID for reconnection support (UUID v4 format for Claude CLI compatibility)
      let currentSessionId = localStorage.getItem('claude_session_id');
      if (!currentSessionId) {
        currentSessionId = uuidv4();
        localStorage.setItem('claude_session_id', currentSessionId);
      }

      // Update sessionId state
      setSessionId(currentSessionId);

      // Build WebSocket URL - Claude Agent API v1
      let wsUrl;
      if (process.env.NEXT_PUBLIC_AI_WS_URL) {
        wsUrl = process.env.NEXT_PUBLIC_AI_WS_URL;
      } else {
        // Default to localhost:8002
        wsUrl = `/ws/chat`;
      }

      console.log("Connecting to Claude Agent API:", wsUrl);
      setConnectionStatus("connecting");

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket connected to Claude Agent API");
          setConnectionStatus("connected");
          setWsConnection(ws);
          reconnectAttemptsRef.current = 0;
        };

        ws.onmessage = (event) => {
          try {
            // Handle both JSON and text messages from Claude Agent SDK
            let data;
            try {
              data = JSON.parse(event.data);
            } catch (e) {
              // If parsing fails, treat as text message
              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                  return [...prev.slice(0, -1), {
                    ...lastMsg,
                    content: (lastMsg.content || '') + event.data,
                    isStreaming: true
                  }];
                }
                return [...prev, {
                  role: 'assistant',
                  content: event.data,
                  type: 'text',
                  timestamp: new Date().toISOString(),
                  isStreaming: true
                }];
              });
              return;
            }

            console.log("WebSocket message received:", data);

            // Handle different message types from Claude Agent API
            if (data.type === 'ping') {
              // Respond to heartbeat
              ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
              console.log('📡 Pong sent');
            } else if (data.type === 'permission_request') {
              // Tool approval request
              console.log('🔧 Tool approval requested:', data.tool_name);
              setPendingApproval({
                tool_name: data.tool_name,
                input_data: data.input_data,
                suggestions: data.suggestions || []
              });
              setMessages((prev) => [...prev, {
                role: 'assistant',
                content: `Requesting permission to use tool: **${data.tool_name}**\n\`\`\`json\n${JSON.stringify(data.input_data, null, 2)}\n\`\`\``,
                type: 'permission_request',
                timestamp: new Date().toISOString(),
                isStreaming: false
              }]);
            } else if (data.type === 'error') {
              // Error message
              console.error('❌ Error from server:', data.error);
              setMessages((prev) => [...prev, {
                role: 'assistant',
                content: `Error: ${data.error}`,
                type: 'error',
                timestamp: new Date().toISOString(),
                isStreaming: false
              }]);
              setIsSending(false);
            } else {
              // Default: treat as text content (streaming from Claude)
              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                  return [...prev.slice(0, -1), {
                    ...lastMsg,
                    content: (lastMsg.content || '') + (typeof data === 'string' ? data : JSON.stringify(data, null, 2)),
                    isStreaming: true
                  }];
                }
                return [...prev, {
                  role: 'assistant',
                  content: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
                  type: 'text',
                  timestamp: new Date().toISOString(),
                  isStreaming: true
                }];
              });
            }
          } catch (error) {
            console.error("Error handling WebSocket message:", error);
            setIsSending(false);
          }
        };

        ws.onclose = (event) => {
          console.log("WebSocket disconnected:", event.code, event.reason);
          setConnectionStatus("disconnected");
          setWsConnection(null);

          // Mark last message as not streaming
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
              return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
            }
            return prev;
          });
          setIsSending(false);

          // Auto-reconnect if not a normal closure
          if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current += 1;
            console.log(`Reconnecting... Attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}`);
            reconnectTimeoutRef.current = setTimeout(() => {
              connectWebSocket();
            }, 3000);
          } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            setMessages((prev) => [...prev, {
              role: 'assistant',
              content: 'Connection lost. Please refresh the page.',
              type: 'error',
              timestamp: new Date().toISOString(),
              isStreaming: false
            }]);
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          setConnectionStatus("error");
        };

      } catch (error) {
        console.error("Failed to create WebSocket connection:", error);
        setConnectionStatus("error");
      }
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
        wsRef.current = null;
      }
    };
  }, [session, setMessages, setIsSending]);

  return { wsConnection, connectionStatus, sessionId, pendingApproval, setPendingApproval };
};
