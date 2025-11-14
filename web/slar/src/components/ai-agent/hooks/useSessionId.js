import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

export const useSessionId = () => {
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    // Get or generate session ID (compatible with Claude CLI - requires UUID format)
    let storedSessionId = localStorage.getItem('claude_session_id');
    if (!storedSessionId) {
      storedSessionId = uuidv4();
      localStorage.setItem('claude_session_id', storedSessionId);
    }
    setSessionId(storedSessionId);
  }, []);

  const resetSession = () => {
    // Generate new session ID (UUID v4 format)
    const newSessionId = uuidv4();
    localStorage.setItem('claude_session_id', newSessionId);
    setSessionId(newSessionId);
    return newSessionId;
  };

  return { sessionId, resetSession };
};
