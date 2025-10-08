"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from '../../contexts/AuthContext';
import { ChatInput } from '../../components/ui';
import {
  ChatHeader,
  MessagesList,
  statusColor,
  severityColor,
  useWebSocket,
  useChatHistory,
  useAutoScroll,
  useAttachedIncident,
  useChatSubmit
} from '../../components/ai-agent';
import 'highlight.js/styles/github.css';

export default function AIAgentPage() {
  const { session } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef(null);

  // Custom hooks để tổ chức logic
  const { wsConnection, connectionStatus } = useWebSocket(session, setMessages, setIsSending);
  const { attachedIncident, setAttachedIncident } = useAttachedIncident();
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

  // Load chat history và auto-scroll
  useChatHistory(setMessages);
  useAutoScroll(messages, endRef);

  return (
    <div className="flex flex-col bg-white dark:bg-gray-900">
      <ChatHeader connectionStatus={connectionStatus} />

      <MessagesList
        messages={messages}
        isSending={isSending}
        endRef={endRef}
      />

      <ChatInput
        value={input}
        onChange={useCallback((e) => setInput(e.target.value), [])}
        onSubmit={onSubmit}
        isLoading={isSending}
        placeholder="Ask anything about incidents..."
        loadingText="Đang xử lý..."
        attachedIncident={attachedIncident}
        onRemoveAttachment={useCallback(() => setAttachedIncident(null), [])}
        statusColor={statusColor}
        severityColor={severityColor}
        showModeSelector={false}
      />
    </div>
  );
}

