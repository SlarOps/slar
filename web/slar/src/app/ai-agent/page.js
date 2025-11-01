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
  useAttachedIncident,
} from '../../components/ai-agent';
import { ToolApprovalModal } from '../../components/ai-agent/ToolApprovalModal';
import 'highlight.js/styles/github.css';
import { useHttpStreamingChat } from '../../hooks/useHttpStreamingChat';

export default function AIAgentPage() {
  const { session } = useAuth();
  const [input, setInput] = useState("");
  const endRef = useRef(null);

  // Use HTTP streaming instead of WebSocket
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
  } = useHttpStreamingChat();

  const { attachedIncident, setAttachedIncident } = useAttachedIncident();

  // Handle chat submit
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!input.trim() || isSending) {
      return;
    }

    const message = input.trim();
    setInput("");

    // Include attached incident context if available
    let fullMessage = message;
    if (attachedIncident) {
      fullMessage = `Context: Incident #${attachedIncident.id} - ${attachedIncident.title}\n\n${message}`;
    }

    await sendMessage(fullMessage);
  }, [input, isSending, attachedIncident, sendMessage]);

  // Handle session reset
  const handleSessionReset = useCallback(() => {
    resetSession();
    console.log('Session reset. New session will be created on next message.');
  }, [resetSession]);

  // Handle input change
  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
  }, []);

  // Handle remove attachment
  const handleRemoveAttachment = useCallback(() => {
    setAttachedIncident(null);
  }, [setAttachedIncident]);

  // Auto-scroll to bottom
  useAutoScroll(messages, endRef);

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] bg-white dark:bg-gray-900">
      <div className="flex-shrink-0">
        <ChatHeader />
      </div>

      <MessagesList
        messages={messages}
        isSending={isSending}
        endRef={endRef}
      />

      <div className="flex-shrink-0">
        <ChatInput
          value={input}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          isLoading={isSending}
          placeholder="Ask anything about incidents..."
          loadingText="Đang xử lý..."
          attachedIncident={attachedIncident}
          onRemoveAttachment={handleRemoveAttachment}
          statusColor={statusColor}
          severityColor={severityColor}
          showModeSelector={false}
          onStop={stopStreaming}
          sessionId={sessionId}
          isStreaming={isSending}
          onSessionReset={handleSessionReset}
        />
      </div>

      {/* Tool Approval Modal */}
      {pendingApproval && (
        <ToolApprovalModal
          isOpen={!!pendingApproval}
          onClose={() => {}}
          toolName={pendingApproval.tool_name}
          toolArgs={pendingApproval.tool_args}
          onApprove={() => approveTool(pendingApproval.approval_id, 'Approved by user')}
          onDeny={() => denyTool(pendingApproval.approval_id, 'Denied by user')}
        />
      )}
    </div>
  );
}
