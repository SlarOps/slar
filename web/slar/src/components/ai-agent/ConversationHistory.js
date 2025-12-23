/**
 * ConversationHistory Component - Claude Agent Conversation History Sidebar
 *
 * Displays list of past conversations for resume functionality.
 * Supports: new conversation, resume, archive, delete operations.
 */

import { useState, useEffect, useCallback } from 'react';
import apiClient from '../../lib/api';

// Format relative time
function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Truncate text with ellipsis
function truncateText(text, maxLength = 50) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

export function ConversationHistory({
  isOpen,
  onClose,
  onNewConversation,
  onResumeConversation,
  currentConversationId,
  authToken,
}) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  // Animation states
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Handle animation on open/close
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      setIsAnimating(false);
      // Wait for animation to complete before unmounting
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 300); // Match transition duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!authToken) return;

    setLoading(true);
    setError(null);

    try {
      apiClient.setToken(authToken);
      const result = await apiClient.getConversations({
        limit: 50,
        archived: showArchived,
      });

      if (result.success) {
        setConversations(result.conversations || []);
      } else {
        setError(result.error || 'Failed to load conversations');
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
      setError('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, [authToken, showArchived]);

  // Load on mount and when panel opens
  useEffect(() => {
    if (isOpen && authToken) {
      loadConversations();
    }
  }, [isOpen, authToken, loadConversations]);

  // Handle archive conversation
  const handleArchive = async (conversationId, e) => {
    e.stopPropagation();
    try {
      apiClient.setToken(authToken);
      await apiClient.updateConversation(conversationId, { is_archived: true });
      loadConversations();
    } catch (err) {
      console.error('Error archiving conversation:', err);
    }
  };

  // Handle delete conversation
  const handleDelete = async (conversationId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation? This cannot be undone.')) return;

    try {
      apiClient.setToken(authToken);
      await apiClient.deleteConversation(conversationId);
      loadConversations();
    } catch (err) {
      console.error('Error deleting conversation:', err);
    }
  };

  // Handle resume
  const handleResume = (conversation) => {
    onResumeConversation(conversation.conversation_id);
    onClose();
  };

  // Handle new conversation
  const handleNew = () => {
    onNewConversation();
    onClose();
  };

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop with fade animation */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ease-out ${
          isAnimating ? 'opacity-50' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Sidebar - Right side with slide animation */}
      <div className="absolute inset-y-0 right-0 flex max-w-full">
        <div
          className={`relative w-screen max-w-sm transform transition-transform duration-300 ease-out ${
            isAnimating ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex h-full flex-col bg-white dark:bg-gray-900 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Conversations
              </h2>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* New Conversation Button */}
            <div className="px-4 py-3">
              <button
                onClick={handleNew}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Conversation
              </button>
            </div>

            {/* Filter Toggle */}
            <div className="px-4 pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                Show archived
              </label>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto px-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : error ? (
                <div className="p-4 text-center">
                  <p className="text-red-500 text-sm">{error}</p>
                  <button
                    onClick={loadConversations}
                    className="mt-2 text-blue-600 hover:text-blue-700 text-sm"
                  >
                    Retry
                  </button>
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  <p className="text-sm">No conversations yet</p>
                  <p className="text-xs mt-1">Start a new conversation to begin</p>
                </div>
              ) : (
                <div className="space-y-1 py-2">
                  {conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      onClick={() => handleResume(conversation)}
                      className={`
                        group flex flex-col p-3 rounded-lg cursor-pointer transition-colors
                        ${conversation.conversation_id === currentConversationId
                          ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                        }
                      `}
                    >
                      {/* Title & Time */}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium text-sm text-gray-900 dark:text-gray-100 line-clamp-1">
                          {conversation.title || 'Untitled'}
                        </h3>
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap flex-shrink-0">
                          {formatRelativeTime(conversation.last_message_at || conversation.created_at)}
                        </span>
                      </div>

                      {/* Preview */}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                        {truncateText(conversation.first_message, 80)}
                      </p>

                      {/* Meta & Actions */}
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {conversation.message_count || 0} messages
                          </span>
                          {conversation.is_archived && (
                            <span className="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                              Archived
                            </span>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!conversation.is_archived && (
                            <button
                              onClick={(e) => handleArchive(conversation.conversation_id, e)}
                              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                              title="Archive"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDelete(conversation.conversation_id, e)}
                            className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConversationHistory;
