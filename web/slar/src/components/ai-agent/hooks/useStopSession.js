import { useState } from 'react';
import { apiClient } from '../../../lib/api';

export const useStopSession = (sessionId, wsConnection, setIsSending, setMessages) => {
  const [isStopping, setIsStopping] = useState(false);

  const stopSession = async (sessionIdToStop) => {
    if (!sessionIdToStop) {
      console.error('No session ID provided for stop');
      return;
    }

    setIsStopping(true);
    
    try {
      // 1. First, close WebSocket connection to stop receiving messages
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.close(1000, "User requested stop");
      }

      // 2. Call API to stop streaming session
      const response = await apiClient.stopSession(sessionIdToStop);
      
      if (response.status === 'success') {
        // 3. Update UI state
        setIsSending(false);
        
        // 4. Add system message to indicate session was stopped
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: "🛑 Session stopped by user.",
          source: "system",
          type: "system",
          isStreaming: false
        }]);

        console.log('Session stopped successfully:', response);
      } else {
        throw new Error(response.message || 'Failed to stop session');
      }
    } catch (error) {
      console.error('Error stopping session:', error);
      
      // Add error message to chat
      setMessages((prev) => [...prev, {
        role: "assistant", 
        content: `❌ Error stopping session: ${error.message}`,
        source: "system",
        type: "error",
        isStreaming: false
      }]);
      
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
