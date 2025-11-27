"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { ChatInput } from '../../components/ui';
import {
  ChatHeader,
  MessagesList,
  TodoList,
  statusColor,
  severityColor,
  useAutoScroll,
} from '../../components/ai-agent';
import 'highlight.js/styles/github.css';
import { useClaudeWebSocket } from '../../hooks/useClaudeWebSocket';
import { useSyncBucket } from '../../hooks/useSyncBucket';

function AIAgentContent() {
  const { session } = useAuth();
  const searchParams = useSearchParams();
  const incidentId = searchParams.get('incident');
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  const messageAreaRef = useRef(null);

  // Pre-fill input with incident context if available
  useEffect(() => {
    if (incidentId) {
      setInput(`Analyze incident ${incidentId}`);
    }
  }, [incidentId]);

  // Extract auth token from session
  const authToken = session?.access_token || null;

  // Step 1: Sync bucket before connecting WebSocket
  const {
    syncStatus,
    syncMessage,
    syncBucket,
    retrySync
  } = useSyncBucket(authToken);

  // Step 2: Use WebSocket connection (manual connect)
  const {
    messages,
    setMessages,
    connectionStatus,
    isSending,
    sendMessage,
    stopStreaming,
    sessionId,
    resetSession,
    pendingApprovals,
    approveTool,
    approveToolAlways,
    denyTool,
    todos,
    connect: connectWebSocket,
  } = useClaudeWebSocket(authToken, { autoConnect: false });

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

  // Trigger sync on mount (only once per auth token)
  const hasSynced = useRef(false);
  useEffect(() => {
    if (!authToken) {
      console.log('No auth token, skipping sync');
      return;
    }

    // Only sync once per session
    if (!hasSynced.current) {
      console.log('Triggering initial sync...');
      syncBucket();
      hasSynced.current = true;
    }
  }, [authToken, syncBucket]);

  // Connect WebSocket after successful sync
  useEffect(() => {
    if (syncStatus === 'ready') {
      console.log('Sync complete, connecting WebSocket...');
      connectWebSocket();
    }
  }, [syncStatus, connectWebSocket]);

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

  // Handle incident analysis from URL





  // Auto-scroll to bottom
  useAutoScroll(messages, endRef);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Loading State - Syncing Bucket */}
      {syncStatus === 'syncing' && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <svg className="animate-spin h-12 w-12 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">{syncMessage}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">This may take a few seconds...</p>
            </div>
          </div>
        </div>
      )}

      {/* Error State - Sync Failed */}
      {syncStatus === 'error' && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-md">
            <div className="flex justify-center">
              <svg className="h-12 w-12 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Connection Error</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{syncMessage}</p>
            </div>
            <button
              onClick={retrySync}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors touch-manipulation"
            >
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Ready State - Show Chat Interface */}
      {(syncStatus === 'ready' || syncStatus === 'idle') && (
        <>
          <div
            ref={messageAreaRef}
            className="flex-1 overflow-y-auto overflow-x-hidden"
          >
            <div className="max-w-3xl mx-auto px-4 pb-32 pt-4">
              {/* Messages List */}
              <MessagesList
                messages={messages}
                isSending={isSending}
                endRef={endRef}
                onRegenerate={handleRegenerate}
                onApprove={approveTool}
                onApproveAlways={approveToolAlways}
                onDeny={denyTool}
                pendingApprovals={pendingApprovals}
              />
            </div>
          </div>

          <ChatInput
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder="Ask anything about incidents..."
            statusColor={statusColor}
            severityColor={severityColor}
            showModeSelector={false}
            onStop={stopStreaming}
            isSending={isSending}
            sessionId={sessionId}
            onSessionReset={handleSessionReset}
            syncStatus={syncStatus}
            todos={todos}
          />
        </>
      )}
    </div>
  );
}

export default function AIAgentPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    }>
      <AIAgentContent />
    </Suspense>
  );
}
