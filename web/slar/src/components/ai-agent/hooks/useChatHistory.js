import { useEffect, useRef } from 'react';
import { apiClient } from '../../../lib/api';

export const useChatHistory = (setMessagesFromHistory, sessionId = null) => {
  const loadedRef = useRef(false);
  const currentSessionRef = useRef(null);

  useEffect(() => {
    // Don't load if no sessionId yet or if we already loaded for this session
    if (!sessionId || currentSessionRef.current === sessionId) {
      return;
    }

    const loadHistory = async () => {
      try {
        let history = [];
        
        console.log(`Loading history for session: ${sessionId}`);
        
        // Try to load session-specific history first
        try {
          const sessionHistoryResponse = await apiClient.getSessionHistory(sessionId);
          history = sessionHistoryResponse.history || [];
          console.log(`Loaded ${history.length} messages from session history`);
        } catch (sessionError) {
          console.log('Session history not found, trying to load session from disk...');
          
          // Try to load session from disk
          try {
            await apiClient.loadSession(sessionId);
            const sessionHistoryResponse = await apiClient.getSessionHistory(sessionId);
            history = sessionHistoryResponse.history || [];
            console.log(`Loaded ${history.length} messages after loading session from disk`);
          } catch (loadError) {
            console.log('Failed to load session from disk, falling back to global history');
            // Fallback to global history
            history = await apiClient.getChatHistory();
          }
        }

        if (history && history.length > 0) {
          const historyMessages = history.map(msg => {
            let processedContent;
            let originalContent = null;

            // Handle different message types from AutoGen
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

            // if (msg.type === 'ToolCallExecutionEvent') {
            //   const toolResults = [];
            //   for (const toolCall of msg.content) {
            //     console.log(toolCall);
            //     console.log(JSON.parse(toolCall.content));
            //     toolResults.push(`🔧 **${toolCall.name || 'Tool'} Result:**\n\`\`\`\n${toolCall.content}\n\`\`\``);
            //   }
            //   processedContent = toolResults.join('\n\n');
            // }

            // if (msg.type === 'ToolCallRequestEvent') {
            //   console.log("ToolCallRequestEvent");
            //   console.log(msg.content);
            //   const toolRequests = [];
            //   for (const toolCall of msg.content) {
            //     console.log(toolCall);
            //     toolRequests.push(`⚡ **Calling ${toolCall.name}**\n\`\`\`json\n${toolCall.arguments}\n\`\`\``);
            //   }
            //   processedContent = toolRequests.join('\n\n');
            // }

            // Map AutoGen message types to UI roles
            let role = 'assistant'; // default
            if (msg.source === 'user') {
              role = 'user';
            } else if (msg.type === 'UserMessage') {
              role = 'user';
            } else if (msg.type === 'AssistantMessage' || msg.source !== 'user') {
              role = 'assistant';
            }

            return {
              role: role,
              content: processedContent,
              originalContent: originalContent,
              type: msg.type || 'TextMessage',
              source: msg.source || 'unknown',
              agent_name: msg.agent_name || null,
              thought: msg.thought || null,
              incidents: msg.incidents || null
            };
          });
          
          // Filter out empty or invalid messages
          const validMessages = historyMessages.filter(msg => 
            msg.content && msg.content.trim().length > 0
          );
          
          // Only set messages if we have valid content
          if (validMessages.length > 0) {
            setMessagesFromHistory(validMessages);
            loadedRef.current = true;
            currentSessionRef.current = sessionId;
            console.log(`Successfully loaded ${validMessages.length} messages into chat (${historyMessages.length} total from history)`);
            return;
          }
        }
        
        // Only show welcome message if we haven't loaded any history yet
        if (!loadedRef.current) {
          // const welcomeMessage = "Xin chào! Mình là AI Agent của SLAR. Hãy nhập câu hỏi ở dưới để bắt đầu.";
          setMessagesFromHistory([]);
          loadedRef.current = true;
          currentSessionRef.current = sessionId;
        }
        
      } catch (error) {
        console.error('Error loading chat history:', error);
        
        // Only show welcome message if we haven't loaded any history yet
        if (!loadedRef.current) {
          // const welcomeMessage = "Xin chào! Mình là AI Agent của SLAR. Hãy nhập câu hỏi ở dưới để bắt đầu.";
          setMessagesFromHistory([]);
          loadedRef.current = true;
          currentSessionRef.current = sessionId;
        }
      }
    };

    loadHistory();
  }, [setMessagesFromHistory, sessionId]);

  // Reset loaded state when sessionId changes to null or different value
  useEffect(() => {
    if (!sessionId || currentSessionRef.current !== sessionId) {
      loadedRef.current = false;
    }
  }, [sessionId]);
};
