import React, { useState } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { TodoList } from '../ai-agent/TodoList';
import { ShareModal } from './ShareModal';

const ChatInput = ({
  value,
  onChange,
  onSubmit,
  placeholder = "Type your message...",
  statusColor = () => "bg-gray-100 text-gray-800",
  severityColor = () => "bg-gray-100 text-gray-800",
  currentMode = "agent",
  onModeChange = () => { },
  showModeSelector = true,
  onStop = null,
  sessionId = null,
  onNewChat = null,
  isSending = false,
  syncStatus = 'idle',
  todos = [],
  conversationId = null,
  hasMessages = false
}) => {
  const [showShareModal, setShowShareModal] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(e);
  };

  const handleStop = () => {
    if (onStop) {
      onStop();
    }
  };

  const hasTodos = todos && todos.length > 0;

  return (
    <div className="sticky bottom-0 left-0 right-0 bg-gray-50 dark:bg-gray-950" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}>
      {/* Todo List - Integrated above input */}
      {hasTodos && (
        <div className="pb-2">
          <div className="max-w-3xl mx-auto px-4">
            <TodoList todos={todos} />
          </div>
        </div>
      )}
      <div className="pb-4 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Chat Input */}
          <form onSubmit={handleSubmit}>
            <div className="flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 shadow-lg shadow-gray-200/50 dark:shadow-gray-900/50">
              {/* New Chat Button - keeps WebSocket session for interrupts */}
              {sessionId && onNewChat && (
                <div className="flex-shrink-0">
                  <button
                    type="button"
                    onClick={onNewChat}
                    className="p-2 text-blue-600 dark:text-blue-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 rounded-md transition-colors"
                    title="Start new conversation"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Share Button */}
              {conversationId && hasMessages && (
                <div className="flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowShareModal(true)}
                    className="p-2 text-blue-600 dark:text-blue-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 rounded-md transition-colors"
                    title="Share conversation"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Mode Selector */}
              {showModeSelector && (
                <Menu as="div" className="relative">
                  <Menu.Button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Switch Mode">
                    {currentMode === 'agent' ? (
                      <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.126-.275c-1.014-.162-1.521-.243-1.875-.243-.354 0-.861.081-1.875.243A8.955 8.955 0 015 20c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8z" />
                      </svg>
                    )}
                  </Menu.Button>

                  <Transition
                    enter="transition duration-100 ease-out"
                    enterFrom="transform scale-95 opacity-0"
                    enterTo="transform scale-100 opacity-100"
                    leave="transition duration-75 ease-out"
                    leaveFrom="transform scale-100 opacity-100"
                    leaveTo="transform scale-95 opacity-0"
                  >
                    <Menu.Items className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            type="button"
                            onClick={() => onModeChange('agent')}
                            className={`w-full px-4 py-3 text-left flex items-center space-x-3 ${active ? 'bg-gray-50 dark:bg-gray-700' : ''
                              } ${currentMode === 'agent' ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          >
                            <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            <div>
                              <div className="font-medium text-gray-900 dark:text-gray-100">AI Agent</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">Smart assistant with tools</div>
                            </div>
                            {currentMode === 'agent' && (
                              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            type="button"
                            onClick={() => onModeChange('chat')}
                            className={`w-full px-4 py-3 text-left flex items-center space-x-3 ${active ? 'bg-gray-50 dark:bg-gray-700' : ''
                              } ${currentMode === 'chat' ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          >
                            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.126-.275c-1.014-.162-1.521-.243-1.875-.243-.354 0-.861.081-1.875.243A8.955 8.955 0 015 20c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8z" />
                            </svg>
                            <div>
                              <div className="font-medium text-gray-900 dark:text-gray-100">Chat</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">Simple conversation</div>
                            </div>
                            {currentMode === 'chat' && (
                              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        )}
                      </Menu.Item>
                    </Menu.Items>
                  </Transition>
                </Menu>
              )}

              {/* Input Field */}
              <input
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                className="flex-1 bg-transparent px-2 py-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none"
              />

              {/* Stop Button - Show when streaming/sending */}
              {onStop && isSending && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-200 dark:hover:bg-red-900/20 rounded-md transition-colors animate-pulse"
                  title="Stop generating"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              )}

              {/* Send Button */}
              <button
                type="submit"
                disabled={value.trim().length === 0}
                className={`p-2 hover:opacity-80 disabled:opacity-40 transition-colors ${syncStatus === 'ready'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-400 dark:text-gray-500'
                  }`}
                title={syncStatus === 'ready' ? 'Send' : 'Waiting for workspace...'}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Share Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        conversationId={conversationId}
        expiresIn={168}
      />
    </div>
  );
};

export default ChatInput;
