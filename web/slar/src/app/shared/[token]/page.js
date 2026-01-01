"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { MessageComponent } from '../../../components/ai-agent';

// Public shared conversation viewer - no auth required
export default function SharedConversationPage() {
  const params = useParams();
  const token = params.token;
  const endRef = useRef(null);

  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchSharedConversation() {
      if (!token) return;

      setLoading(true);
      setError(null);

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const response = await fetch(`${apiUrl}/api/shared/${token}`);

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (response.status === 404) {
            throw new Error('This share link is invalid or has been revoked.');
          } else if (response.status === 410) {
            throw new Error('This share link has expired.');
          } else {
            throw new Error(data.error || 'Failed to load shared conversation');
          }
        }

        const data = await response.json();
        setConversation(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchSharedConversation();
  }, [token]);

  // Transform API messages to match MessageComponent format
  const transformMessages = (messages) => {
    if (!messages) return [];
    return messages.map((msg, idx) => ({
      id: idx,
      role: msg.role,
      content: msg.content,
      type: msg.type || 'text',
      tool_name: msg.tool_name,
      tool_input: msg.tool_input,
      created_at: msg.created_at,
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto" />
          <p className="text-gray-600 dark:text-gray-400">Loading shared conversation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-4">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Unable to Load</h1>
          <p className="text-gray-600 dark:text-gray-400">{error}</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  if (!conversation) {
    return null;
  }

  const messages = transformMessages(conversation.messages);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">
                {conversation.title}
              </h1>
              {conversation.description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 truncate">
                  {conversation.description}
                </p>
              )}
            </div>
            <div className="flex-shrink-0 ml-4 text-right">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {conversation.message_count} messages
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500">
                {new Date(conversation.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Messages - Reusing ai-agent MessageComponent */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-2 sm:px-4 py-4">
          {messages.map((message) => (
            <MessageComponent
              key={message.id}
              message={message}
              pendingApprovals={[]}
            />
          ))}
          <div ref={endRef} />
        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 py-4 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Shared via SLAR AI Agent
          </p>
          <Link
            href="/"
            className="text-sm text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            Learn more about SLAR
          </Link>
        </div>
      </footer>
    </div>
  );
}
