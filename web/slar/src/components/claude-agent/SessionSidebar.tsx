/**
 * Session Sidebar Component
 * Shows list of sessions with load/delete functionality
 */

'use client';

import React, { useState } from 'react';
import { useSessionManager } from '@/hooks/useSessionManager';
import { TrashIcon, ClockIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline';

interface SessionSidebarProps {
  currentSessionId?: string | null;
  onSessionSelect?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
}

export function SessionSidebar({
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
}: SessionSidebarProps) {
  const { sessions, loading, loadSessions, deleteSession } = useSessionManager();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this session?')) {
      return;
    }

    try {
      setDeletingId(sessionId);
      await deleteSession(sessionId);
      onSessionDelete?.(sessionId);
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('Failed to delete session');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSessionClick = (sessionId: string) => {
    onSessionSelect?.(sessionId);
  };

  const handleRefresh = () => {
    loadSessions();
  };

  return (
    <div className="w-64 h-full bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Sessions</h3>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            title="Refresh sessions"
          >
            <svg
              className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center justify-center h-32 px-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
              No sessions yet. Start a conversation to create one.
            </div>
          </div>
        ) : (
          <div className="py-2">
            {sessions.map((session) => (
              <div
                key={session.session_id}
                onClick={() => handleSessionClick(session.session_id)}
                className={`mx-2 mb-2 p-3 rounded-lg cursor-pointer transition-colors ${
                  currentSessionId === session.session_id
                    ? 'bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700'
                    : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <ChatBubbleLeftIcon className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
                        {session.session_id.slice(0, 12)}...
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <ClockIcon className="w-3 h-3" />
                      <span>{session.message_count} messages</span>
                    </div>

                    {session.last_updated && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {new Date(session.last_updated).toLocaleDateString()}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={(e) => handleDelete(session.session_id, e)}
                    disabled={deletingId === session.session_id}
                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors flex-shrink-0 disabled:opacity-50"
                    title="Delete session"
                  >
                    <TrashIcon className="w-4 h-4 text-red-500 dark:text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
