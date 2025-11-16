"use client";

import { useState, useRef, useCallback, useEffect } from "react";
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
import { useSyncBucket } from '../../hooks/useSyncBucket';

export default function AIAgentPage() {
  const { session } = useAuth();
  const [input, setInput] = useState("");
  const [isNavVisible, setIsNavVisible] = useState(true);
  const endRef = useRef(null);
  const messageAreaRef = useRef(null);
  const lastClickTime = useRef(0);

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
    pendingApproval,
    approveTool,
    denyTool,
    connect: connectWebSocket,
  } = useClaudeWebSocket(authToken, { autoConnect: true });

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

  // Sync-then-connect flow
  useEffect(() => {
    if (!authToken) {
      console.log('No auth token, skipping sync');
      return;
    }

    // Trigger sync on mount
    syncBucket();
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

  // Auto-scroll to bottom
  useAutoScroll(messages, endRef);

  // Toggle navigation visibility
  const toggleNav = useCallback(() => {
    setIsNavVisible(prev => !prev);
  }, []);

  // Notify MobileNav when nav visibility changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('toggleNavVisibility', {
      detail: { visible: isNavVisible }
    }));
  }, [isNavVisible]);

  // Keyboard shortcut: Cmd/Ctrl + B to toggle nav
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+B (Mac) or Ctrl+B (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleNav();
      }
      // Esc to show nav (exit fullscreen)
      if (e.key === 'Escape' && !isNavVisible) {
        toggleNav();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleNav, isNavVisible]);

  // Double click to toggle nav
  const handleMessageAreaClick = useCallback((e) => {
    // Ignore clicks on interactive elements
    if (
      e.target.tagName === 'BUTTON' ||
      e.target.tagName === 'A' ||
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.closest('button') ||
      e.target.closest('a') ||
      e.target.closest('input') ||
      e.target.closest('textarea') ||
      e.target.closest('pre') || // Code blocks
      window.getSelection()?.toString() // Text selection
    ) {
      return;
    }

    const now = Date.now();
    const timeSinceLastClick = now - lastClickTime.current;

    // Double click detection (within 300ms)
    if (timeSinceLastClick < 300) {
      toggleNav();
      lastClickTime.current = 0; // Reset
    } else {
      lastClickTime.current = now;
    }
  }, [toggleNav]);

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 -mx-1 -my-20">
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
          {/* Toggle Navigation Button */}
          <button
            onClick={toggleNav}
            className={`fixed z-40 p-2 rounded-full bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all ${
              isNavVisible ? 'top-20 right-4' : 'top-4 right-4'
            }`}
            title={`${isNavVisible ? 'Hide' : 'Show'} navigation (⌘B)`}
            aria-label="Toggle navigation"
          >
            {isNavVisible ? (
              // Collapse icon
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              // Expand icon
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>

          {/* Hint for double-click (show once) */}
          {isNavVisible && messages.length === 0 && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm rounded-lg shadow-sm border border-blue-200 dark:border-blue-800 pointer-events-none animate-fade-in">
              💡 Tip: Double-click or press ⌘B to toggle fullscreen
            </div>
          )}

          <div
            ref={messageAreaRef}
            onClick={handleMessageAreaClick}
            className="flex-1 relative"
          >
            <MessagesList
              messages={messages}
              isSending={isSending}
              endRef={endRef}
              onRegenerate={handleRegenerate}
              onApprove={approveTool}
              onDeny={denyTool}
              pendingApprovalId={pendingApproval?.approval_id}
            />
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
          />
        </>
      )}
    </div>
  );
}
