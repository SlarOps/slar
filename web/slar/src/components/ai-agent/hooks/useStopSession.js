import { useState } from 'react';

export const useStopSession = (sessionId, wsConnection, setIsSending, setMessages) => {
  const [isStopping, setIsStopping] = useState(false);

  const stopSession = async (sessionIdToStop) => {
    setIsStopping(true);

    try {
      // Close WebSocket connection to stop streaming
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.close(1000, "User requested stop");
        console.log('WebSocket connection closed by user');
      }

      // Update UI state
      setIsSending(false);

      // Mark last message as not streaming
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
          return [...prev.slice(0, -1), {
            ...lastMsg,
            isStreaming: false
          }];
        }
        return prev;
      });

      console.log('Session stopped successfully');
    } catch (error) {
      console.error('Error stopping session:', error);

      // Still set sending to false to unblock UI
      setIsSending(false);
    } finally {
      setIsStopping(false);
    }
  };

  return {
    stopSession,
    isStopping
  };
};
