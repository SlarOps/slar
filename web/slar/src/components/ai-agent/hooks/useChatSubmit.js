import { useCallback } from 'react';

export const useChatSubmit = (
  input,
  setInput,
  isSending,
  setIsSending,
  connectionStatus,
  wsConnection,
  setMessages,
  sessionId
) => {
  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    // Push user message
    setMessages((prev) => [...prev, {
      role: "user",
      content: text,
      timestamp: new Date().toISOString()
    }]);
    setInput("");
    // setIsSending(true);

    // Check WebSocket connection
    if (connectionStatus !== "connected" || !wsConnection) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Connection to AI agent is not available. Please wait for reconnection...",
        type: "error",
        timestamp: new Date().toISOString()
      }]);
      // setIsSending(false);
      return;
    }

    try {
      // Send message via WebSocket using Claude Agent API v1 format
      const message = {
        prompt: text,
        session_id: sessionId || ""
      };

      wsConnection.send(JSON.stringify(message));
      console.log("Message sent to Claude Agent API:", message);

      // Response will be handled by WebSocket onmessage event
      // No need to wait for response here as it's handled asynchronously

    } catch (err) {
      console.error("Error sending WebSocket message:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error sending message: ${err?.message || String(err)}`,
          type: "error",
          timestamp: new Date().toISOString()
        },
      ]);
      // setIsSending(false);
    }
  }, [input, isSending, connectionStatus, wsConnection, sessionId, setInput, setIsSending, setMessages]);

  return { onSubmit };
};
