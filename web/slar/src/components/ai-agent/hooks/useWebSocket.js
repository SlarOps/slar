import { useState, useRef, useEffect } from 'react';

export const useWebSocket = (session, setMessages, setIsSending) => {
  const [wsConnection, setWsConnection] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const wsRef = useRef(null);

  useEffect(() => {
    const connectWebSocket = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      var wsUrl = `${scheme}://${window.location.host}/ws/chat?token=${session?.access_token}`;
      wsUrl = process.env.NEXT_PUBLIC_AI_WS_URL? process.env.NEXT_PUBLIC_AI_WS_URL : wsUrl;
      
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
            } else if (data.type === 'error') {
              // Display error message
              setMessages((prev) => [...prev, {
                role: "assistant",
                content: `Error: ${data.content}`
              }]);
              setIsSending(false);
            } else if (data.content && data.source) {
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

              setMessages((prev) => [...prev, {
                role: "assistant",
                content: processedContent,
                originalContent: originalContent, // Store original for MemoryQueryEvent
                source: data.source,
                type: data.type,
                metadata: data.metadata,
                results: data.results,
                incidents: data.incidents || null
              }]);

              // Only disable sending if this is an assistant message
              if (data.source !== 'user') {
                setIsSending(false);
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
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: "Connection closed. Please refresh the page."
          }]);

          // Attempt to reconnect after 3 seconds if not a normal closure
          // if (event.code !== 1000) {
          //   setTimeout(() => {
          //     if (wsRef.current?.readyState === WebSocket.CLOSED) {
          //       connectWebSocket();
          //     }
          //   }, 3000);
          // }
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

  return { wsConnection, connectionStatus };
};
