"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from '../../contexts/AuthContext';
import { ChatInput } from '../../components/ui';
import {
  ChatHeader,
  MessagesList,
  TerminalComponent,
  statusColor,
  severityColor,
  useWebSocket,
  useChatHistory,
  useAutoScroll,
  useAttachedIncident,
  useChatSubmit,
  useSessionId,
  useMessagesState,
  useStopSession
} from '../../components/ai-agent';
import 'highlight.js/styles/github.css';

export default function AIAgentPage() {
  const { session } = useAuth();
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [mode, setMode] = useState("chat"); // 'chat' or 'terminal'
  const endRef = useRef(null);

  // Messages state management
  const {
    messages,
    historyLoaded,
    setMessages,
    setMessagesFromHistory,
    resetMessages,
    addMessage
  } = useMessagesState();

  // Session management
  const { sessionId, resetSession } = useSessionId();

  // Custom hooks để tổ chức logic
  const { wsConnection, connectionStatus } = useWebSocket(session, setMessages, setIsSending);
  const { attachedIncident, setAttachedIncident } = useAttachedIncident();
  const { stopSession, isStopping } = useStopSession(sessionId, wsConnection, setIsSending, setMessages);
  const { onSubmit } = useChatSubmit(
    input,
    setInput,
    isSending,
    setIsSending,
    connectionStatus,
    wsConnection,
    attachedIncident,
    setMessages
  );

  // Handle session reset
  const handleSessionReset = useCallback(() => {
    // Reset messages state
    resetMessages();
    
    // Reset session ID
    const newSessionId = resetSession();
    
    // Show welcome message
    setMessagesFromHistory([]);
    
    console.log(`Session reset. New session: ${newSessionId}`);
  }, [resetSession, resetMessages, setMessagesFromHistory]);

  // Handle mode change
  const handleModeChange = useCallback((newMode) => {
    setMode(newMode);
  }, []);

  // Handle input change
  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
  }, []);

  // Handle remove attachment
  const handleRemoveAttachment = useCallback(() => {
    setAttachedIncident(null);
  }, [setAttachedIncident]);

  // Load chat history với session ID và auto-scroll
  useChatHistory(setMessagesFromHistory, sessionId);
  useAutoScroll(messages, endRef);

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] bg-white dark:bg-gray-900">
      <ChatHeader 
        connectionStatus={connectionStatus}
        sessionId={sessionId}
        onSessionReset={handleSessionReset}
        mode={mode}
        onModeChange={handleModeChange}
      />

      {mode === 'chat' ? (
        <>
          <MessagesList
            messages={messages}
            isSending={isSending}
            endRef={endRef}
          />

          <ChatInput
            value={input}
            onChange={handleInputChange}
            onSubmit={onSubmit}
            isLoading={isSending}
            placeholder="Ask anything about incidents..."
            loadingText="Đang xử lý..."
            attachedIncident={attachedIncident}
            onRemoveAttachment={handleRemoveAttachment}
            statusColor={statusColor}
            severityColor={severityColor}
            showModeSelector={false}
            onStop={stopSession}
            sessionId={sessionId}
            isStreaming={isSending}
          />
        </>
      ) : (
        <div className="flex-1 overflow-hidden">
          <TerminalComponent sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}

