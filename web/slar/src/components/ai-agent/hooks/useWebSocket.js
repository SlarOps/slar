import { useState, useRef, useEffect } from 'react';

export const useWebSocket = (session, setMessages, setIsSending) => {
  const [wsConnection, setWsConnection] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [sessionId, setSessionId] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    const connectWebSocket = () => {
      // Check if session and token are available
      if (!session?.access_token) {
        console.log("No access token available, skipping WebSocket connection");
        setConnectionStatus("error");
        return;
      }

      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      
      // Generate or get session ID for reconnection support
      let currentSessionId = localStorage.getItem('ai_chat_session_id');
      if (!currentSessionId) {
        currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        localStorage.setItem('ai_chat_session_id', currentSessionId);
      }
      
      // Update sessionId state
      setSessionId(currentSessionId);
      
      let wsUrl;
      
      if (process.env.NEXT_PUBLIC_AI_WS_URL) {
        // Use custom WS URL but ensure token and session_id are appended
        const baseUrl = process.env.NEXT_PUBLIC_AI_WS_URL;
        const separator = baseUrl.includes('?') ? '&' : '?';
        wsUrl = `${baseUrl}${separator}token=${session.access_token}&session_id=${currentSessionId}`;
      } else {
        // Use default URL with token and session_id
        wsUrl = `${scheme}://${window.location.host}/ws/chat?token=${session.access_token}&session_id=${currentSessionId}`;
      }

      
      setConnectionStatus("connecting");

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket connected");
          setConnectionStatus("connected");
          setWsConnection(ws);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log("WebSocket message received:", data);

            // Handle different message types based on the example
            if (data.type === 'UserInputRequestedEvent') {
              // Re-enable input when user input is requested
              setIsSending(false);
              // Don't add UserInputRequestedEvent to messages, just handle the state
            } else if (data.type === 'error') {
              // Display error message
              setMessages((prev) => [...prev, {
                role: "assistant",
                content: `Error: ${data.content}`
              }]);
              setIsSending(false);
            } else if (data.content !== undefined && data.source) {
              // Handle regular messages with content and source
              // Handle content based on message type
              let processedContent;
              let originalContent = null;

              if (data.type === 'MemoryQueryEvent') {
                // For MemoryQueryEvent, preserve original content structure
                originalContent = data.content;
                processedContent = typeof data.content === 'string'
                  ? data.content
                  : JSON.stringify(data.content);
              } else {
                // For other messages, ensure content is a string
                processedContent = typeof data.content === 'string'
                  ? data.content
                  : JSON.stringify(data.content);
              }

              // Check if this is a streaming message (has full_message_id and type is streaming chunk)
              if (data.full_message_id && data.type === 'ModelClientStreamingChunkEvent') {
                setMessages((prev) => {
                  const lastMessage = prev[prev.length - 1];
                  
                  // If last message has same full_message_id, append content
                  if (lastMessage && lastMessage.full_message_id === data.full_message_id) {
                    console.log("Updating message", lastMessage.content, processedContent);
                    console.log("Updating message", lastMessage.full_message_id, data.full_message_id);
                    const updatedMessage = {
                      ...lastMessage,
                      content: lastMessage.content + processedContent,
                      isStreaming: true, // Keep streaming until we get final TextMessage
                      incidents: data.incidents || lastMessage.incidents,
                      metadata: data.metadata || lastMessage.metadata,
                      results: data.results || lastMessage.results
                    };
                    
                    return [...prev.slice(0, -1), updatedMessage];
                  } else {
                    // New streaming message
                    return [...prev, {
                      role: "assistant",
                      content: processedContent,
                      originalContent: originalContent,
                      source: data.source,
                      type: data.type,
                      metadata: data.metadata,
                      results: data.results,
                      incidents: data.incidents || null,
                      full_message_id: data.full_message_id,
                      isStreaming: true
                    }];
                  }
                });
                // Don't disable sending for streaming chunks
              } else if (data.type === 'TextMessage' && data.id) {
                // This is the final message - update the existing streaming message
                setMessages((prev) => {
                  const lastMessage = prev[prev.length - 1];
                  
                  // If the TextMessage's id matches the last message's full_message_id, update it
                  if (lastMessage && lastMessage.full_message_id === data.id) {
                    // Update the last message with final content and mark as complete
                    const updatedMessage = {
                      ...lastMessage,
                      content: processedContent, // Use final complete content from TextMessage
                      isStreaming: false, // Mark as complete
                      incidents: data.incidents || lastMessage.incidents,
                      metadata: data.metadata || lastMessage.metadata,
                      results: data.results || lastMessage.results
                    };
                    
                    return [...prev.slice(0, -1), updatedMessage];
                  } else {
                    // If no matching streaming message found, create new message
                    return [...prev, {
                      role: "assistant",
                      content: processedContent,
                      originalContent: originalContent,
                      source: data.source,
                      type: data.type,
                      metadata: data.metadata,
                      results: data.results,
                      incidents: data.incidents || null,
                      full_message_id: data.id, // Use TextMessage's id as full_message_id
                      isStreaming: false
                    }];
                  }
                });

                // Disable sending when final message is received
                if (data.source !== 'user') {
                  setIsSending(false);
                }
              } else {
                // Non-streaming message (original behavior)
                setMessages((prev) => [...prev, {
                  role: "assistant",
                  content: processedContent,
                  originalContent: originalContent, // Store original for MemoryQueryEvent
                  source: data.source,
                  type: data.type,
                  metadata: data.metadata,
                  results: data.results,
                  incidents: data.incidents || null,
                  isStreaming: false
                }]);

                // Only disable sending if this is an assistant message
                if (data.source !== 'user') {
                  setIsSending(false);
                }
              }
            } else {
              // Fallback for other message types
              console.log("Received message:", data);
              setIsSending(false);
            }
          } catch (error) {
            console.error("Error parsing WebSocket message:", error);
            setIsSending(false);
          }
        };

        ws.onclose = (event) => {
          console.log("WebSocket disconnected:", event.code, event.reason);
          setConnectionStatus("disconnected");
          setWsConnection(null);
          // setMessages((prev) => [...prev, {
          //   role: "assistant",
          //   content: "Connection closed. Please refresh the page."
          // }]);

          // Attempt to reconnect after 3 seconds if not a normal closure
          if (event.code !== 1000) {
            setTimeout(() => {
              if (wsRef.current?.readyState === WebSocket.CLOSED) {
                connectWebSocket();
              }
            }, 3000);
          }
        };

      } catch (error) {
        console.error("Failed to create WebSocket connection:", error);
        setConnectionStatus("error");
      }
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
        wsRef.current = null;
      }
    };
  }, [session, setMessages, setIsSending]);

  return { wsConnection, connectionStatus, sessionId };
};
