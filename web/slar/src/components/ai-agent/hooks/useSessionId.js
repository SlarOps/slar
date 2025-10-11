import { useState, useEffect } from 'react';

export const useSessionId = () => {
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    // Get or generate session ID
    let storedSessionId = localStorage.getItem('ai_chat_session_id');
    if (!storedSessionId) {
      storedSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      localStorage.setItem('ai_chat_session_id', storedSessionId);
    }
    setSessionId(storedSessionId);
  }, []);

  const resetSession = () => {
    // Generate new session ID
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    localStorage.setItem('ai_chat_session_id', newSessionId);
    setSessionId(newSessionId);
    return newSessionId;
  };

  return { sessionId, resetSession };
};
