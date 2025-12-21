'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../../lib/api';

/**
 * Reusable ShareModal component for sharing conversations
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {Function} props.onClose - Callback when modal is closed
 * @param {string} props.conversationId - The conversation ID to share
 * @param {number} [props.expiresIn=168] - Expiry time in hours (default: 7 days)
 */
export function ShareModal({ isOpen, onClose, conversationId, expiresIn = 168 }) {
  const [shareUrl, setShareUrl] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const isCreatingRef = useRef(false);

  // Create share link
  const createShareLink = useCallback(async () => {
    if (!conversationId || isCreatingRef.current) return;

    isCreatingRef.current = true;
    setIsSharing(true);

    try {
      const result = await apiClient.createConversationShare(conversationId, {
        expires_in: expiresIn,
      });
      const baseUrl = window.location.origin;
      setShareUrl(`${baseUrl}${result.share_url}`);
    } catch (err) {
      console.error('Failed to create share link:', err);
      setError(err.message || 'Failed to create share link');
    } finally {
      setIsSharing(false);
      isCreatingRef.current = false;
    }
  }, [conversationId, expiresIn]);

  // Copy URL to clipboard
  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [shareUrl]);

  // Handle close and reset state
  const handleClose = useCallback(() => {
    setShareUrl(null);
    setCopied(false);
    setError(null);
    onClose();
  }, [onClose]);

  // Reset state and create share link when modal opens
  useEffect(() => {
    if (isOpen && conversationId) {
      // Reset state and create new share link each time modal opens
      isCreatingRef.current = false;
      setShareUrl(null);
      setError(null);
      setCopied(false);
      createShareLink();
    }
    // Only trigger when modal opens or conversation changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conversationId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Share Conversation
          </h3>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
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
                Anyone with this link can view the conversation. The link expires in {Math.floor(expiresIn / 24)} days.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 font-mono"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-1 transition-colors"
                >
                  {copied ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : error ? (
            <div className="py-8 text-center">
              <div className="text-red-500 mb-2">{error}</div>
              <button
                onClick={createShareLink}
                className="text-blue-500 hover:text-blue-600 text-sm"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="py-8 text-center text-red-500">
              Failed to create share link. Please try again.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShareModal;
