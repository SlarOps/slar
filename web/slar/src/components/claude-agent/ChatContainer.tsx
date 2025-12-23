/**
 * Chat Container Component for Claude Agent
 */

'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChatMessageComponent } from './ChatMessage';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { XMarkIcon, ArrowPathIcon, ShareIcon, ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api';

interface ChatContainerProps {
  initialSessionId?: string;
  onSessionIdChange?: (sessionId: string) => void;
}

export function ChatContainer({ initialSessionId, onSessionIdChange }: ChatContainerProps) {
  const [input, setInput] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages,
    sessionId,
    isStreaming,
    connectionStatus,
    sendMessage,
    stopStreaming,
    resetSession,
    loadSession,
  } = useClaudeChat({
    autoSaveSession: true,
    onSessionIdChange,
    onError: (error) => {
      console.error('Chat error:', error);
    },
  });

  // Load initial session
  useEffect(() => {
    if (initialSessionId && !sessionId) {
      loadSession(initialSessionId);
    }
  }, [initialSessionId, sessionId, loadSession]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!input.trim() || isStreaming) {
        return;
      }

      const message = input.trim();
      setInput('');

      // Reset textarea height
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }

      await sendMessage(message);
    },
    [input, isStreaming, sendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);

    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  }, []);

  const handleReset = useCallback(() => {
    if (confirm('Are you sure you want to start a new session? Current session will be saved.')) {
      resetSession();
      setInput('');
    }
  }, [resetSession]);

  const handleShare = useCallback(async () => {
    if (!sessionId || messages.length === 0) {
      return;
    }

    setIsSharing(true);
    setShowShareModal(true);
    setShareUrl(null);
    setCopied(false);

    try {
      const result = await apiClient.createConversationShare(sessionId, {
        expires_in: 168, // 7 days
      });

      const baseUrl = window.location.origin;
      setShareUrl(`${baseUrl}${result.share_url}`);
    } catch (error) {
      console.error('Failed to create share link:', error);
      setShareUrl(null);
    } finally {
      setIsSharing(false);
    }
  }, [sessionId, messages.length]);

  const handleCopyShareUrl = useCallback(async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [shareUrl]);

  const handleCloseShareModal = useCallback(() => {
    setShowShareModal(false);
    setShareUrl(null);
    setCopied(false);
  }, []);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Claude Agent
            </h2>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-green-500'
                    : connectionStatus === 'error'
                    ? 'bg-red-500'
                    : 'bg-gray-400'
                }`}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {connectionStatus}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {sessionId && (
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {sessionId.slice(0, 8)}
              </span>
            )}
            {sessionId && messages.length > 0 && (
              <button
                onClick={handleShare}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                title="Share Conversation"
              >
                <ShareIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            )}
            <button
              onClick={handleReset}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              title="New Session"
            >
              <ArrowPathIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p className="text-lg font-medium mb-2">Start a conversation</p>
              <p className="text-sm">Ask me anything about software engineering and DevOps</p>
            </div>
          </div>
        ) : (
          <div>
            {messages.map((message) => (
              <ChatMessageComponent key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Shift+Enter for new line)"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={1}
              disabled={isStreaming}
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />
          </div>

          <div className="flex gap-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <XMarkIcon className="w-5 h-5" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                Send
              </button>
            )}
          </div>
        </form>

        {isStreaming && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <div className="animate-pulse">●</div>
            Claude is typing...
          </div>
        )}
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Share Conversation
              </h3>
              <button
                onClick={handleCloseShareModal}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <XMarkIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            <div className="px-6 py-4">
              {isSharing ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                  <span className="ml-3 text-gray-600 dark:text-gray-400">
                    Creating share link...
                  </span>
                </div>
              ) : shareUrl ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Anyone with this link can view the conversation. The link expires in 7 days.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 font-mono"
                    />
                    <button
                      onClick={handleCopyShareUrl}
                      className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-1 transition-colors"
                    >
                      {copied ? (
                        <>
                          <CheckIcon className="w-4 h-4" />
                          Copied
                        </>
                      ) : (
                        <>
                          <ClipboardIcon className="w-4 h-4" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-red-500">
                  Failed to create share link. Please try again.
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={handleCloseShareModal}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
