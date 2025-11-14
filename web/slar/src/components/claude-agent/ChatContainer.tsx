/**
 * Chat Container Component for Claude Agent
 */

'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChatMessageComponent } from './ChatMessage';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface ChatContainerProps {
  initialSessionId?: string;
  onSessionIdChange?: (sessionId: string) => void;
}

export function ChatContainer({ initialSessionId, onSessionIdChange }: ChatContainerProps) {
  const [input, setInput] = useState('');
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
    </div>
  );
}
