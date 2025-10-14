import { useState, useCallback, useRef } from 'react';

export const useMessagesState = () => {
  const [messages, setMessages] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyLoadingRef = useRef(false);

  // Protected setMessages that prevents clearing during history load
  const setMessagesProtected = useCallback((newMessages) => {
    if (typeof newMessages === 'function') {
      setMessages(prev => {
        // Don't allow clearing messages if history is currently loading
        if (historyLoadingRef.current && prev.length > 0) {
          const result = newMessages(prev);
          // If the new messages array is empty and we had messages before,
          // and history is loading, keep the previous messages
          if (Array.isArray(result) && result.length === 0 && prev.length > 0) {
            console.log('Preventing message clear during history load');
            return prev;
          }
          return result;
        }
        return newMessages(prev);
      });
    } else {
      setMessages(newMessages);
    }
  }, []);

  // Function to set messages from history loading
  const setMessagesFromHistory = useCallback((historyMessages) => {
    historyLoadingRef.current = true;
    setMessages(historyMessages);
    setHistoryLoaded(true);
    // Allow other operations after a short delay
    setTimeout(() => {
      historyLoadingRef.current = false;
    }, 100);
  }, []);

  // Function to reset messages state
  const resetMessages = useCallback(() => {
    setMessages([]);
    setHistoryLoaded(false);
    historyLoadingRef.current = false;
  }, []);

  // Function to add new message (for WebSocket or user input)
  const addMessage = useCallback((message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  return {
    messages,
    historyLoaded,
    setMessages: setMessagesProtected,
    setMessagesFromHistory,
    resetMessages,
    addMessage
  };
};
