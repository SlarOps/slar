import { useEffect } from 'react';
import { apiClient } from '../../../lib/api';

export const useChatHistory = (setMessages) => {
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await apiClient.getChatHistory();
        const historyMessages = history.map(msg => {
          let processedContent;
          let originalContent = null;

          if (msg.type === 'MemoryQueryEvent') {
            // For MemoryQueryEvent, preserve original content structure
            originalContent = msg.content;
            processedContent = typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
          } else {
            // For other messages, ensure content is a string
            processedContent = typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
          }

          return {
            role: msg.source === 'user' ? 'user' : 'assistant',
            content: processedContent,
            originalContent: originalContent,
            type: msg.type,
            source: msg.source,
            incidents: msg.incidents || null
          };
        });
        setMessages(historyMessages);
        return; // Exit early if history loaded successfully
      } catch (error) {
        console.error('Error loading chat history:', error);
        // Fallback to welcome message if no history
        const welcomeMessage = "Xin chào! Mình là AI Agent của SLAR. Hãy nhập câu hỏi ở dưới để bắt đầu.";
        setMessages([{ role: "assistant", content: welcomeMessage }]);
      }
    };

    loadHistory();
  }, [setMessages]);
};
