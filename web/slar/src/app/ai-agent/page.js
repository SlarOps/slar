"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from '../../contexts/AuthContext';
import { ChatInput } from '../../components/ui';
import {
  ChatHeader,
  MessagesList,
  statusColor,
  severityColor,
  useAutoScroll,
} from '../../components/ai-agent';
import 'highlight.js/styles/github.css';
import { useClaudeWebSocket } from '../../hooks/useClaudeWebSocket';

export default function AIAgentPage() {
  const { session } = useAuth();
  const [input, setInput] = useState("");
  const endRef = useRef(null);

  // Extract auth token from session
  const authToken = session?.access_token || null;

  // Use WebSocket connection with Claude Agent API
  const {
    messages,
    setMessages,
    connectionStatus,
    isSending,
    sendMessage,
    stopStreaming,
    sessionId,
    resetSession,
    pendingApproval,
    approveTool,
    denyTool,
  } = useClaudeWebSocket(authToken);

  // Handle chat submit
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!input.trim()) {
      return;
    }

    const message = input.trim();
    setInput("");

    await sendMessage(message);
  }, [input, sendMessage]);

  // Handle session reset
  const handleSessionReset = useCallback(() => {
    resetSession();
    console.log('Session reset. New session will be created on next message.');
  }, [resetSession]);

  // Handle input change
  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
  }, []);

  // Handle regenerate message
  const handleRegenerate = useCallback((message) => {
    // Find the original user message that led to this assistant response
    const messageIndex = messages.findIndex(m => m === message);
    if (messageIndex > 0) {
      // Look backwards for the last user message
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          sendMessage(messages[i].content);
          break;
        }
      }
    }
  }, [messages, sendMessage]);

  // Auto-scroll to bottom
  useAutoScroll(messages, endRef);

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] bg-white dark:bg-gray-900">
      {/* <div className="flex-shrink-0">
        <ChatHeader />
      </div> */}

      <MessagesList
        messages={messages}
        isSending={isSending}
        endRef={endRef}
        onRegenerate={handleRegenerate}
        onApprove={approveTool}
        onDeny={denyTool}
        pendingApprovalId={pendingApproval?.approval_id}
      />

      <div className="flex-shrink-0">
        <ChatInput
          value={input}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          placeholder="Ask anything about incidents..."
          statusColor={statusColor}
          severityColor={severityColor}
          showModeSelector={false}
          onStop={stopStreaming}
          sessionId={sessionId}
          onSessionReset={handleSessionReset}
        />
      </div>

      {/* Tool Approval is now inline in messages - no modal needed */}
    </div>
  );
}
