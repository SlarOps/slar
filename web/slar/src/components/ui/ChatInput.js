import React from 'react';
import { Menu, Transition } from '@headlessui/react';

const ChatInput = ({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  placeholder = "Type your message...",
  loadingText = "Sending...",
  attachedIncident = null,
  onRemoveAttachment = null,
  statusColor = () => "bg-gray-100 text-gray-800",
  severityColor = () => "bg-gray-100 text-gray-800",
  currentMode = "agent",
  onModeChange = () => {},
  showModeSelector = true
}) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim() || isLoading) return;
    onSubmit(e);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur">
      <div className="px-4 py-4">
        <div className="max-w-3xl mx-auto">
          {/* Attached Incident Display */}
          {attachedIncident && (
            <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                        Incident #{attachedIncident.id.slice(-8)}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor(attachedIncident.status)}`}>
                        {attachedIncident.status.toUpperCase()}
                      </span>
                      {attachedIncident.severity && (
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${severityColor(attachedIncident.severity)}`}>
                          {attachedIncident.severity.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-blue-800 dark:text-blue-200 font-medium truncate">
                      {attachedIncident.title}
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                      {attachedIncident.service_name && `Service: ${attachedIncident.service_name} • `}
                      Created: {new Date(attachedIncident.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {onRemoveAttachment && (
                  <button
                    type="button"
                    onClick={onRemoveAttachment}
                    className="flex-shrink-0 text-blue-400 hover:text-blue-600 dark:text-blue-300 dark:hover:text-blue-100"
                    title="Remove attachment"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Chat Input */}
          <form onSubmit={handleSubmit}>
            <div className="flex items-center rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2">
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
                            className={`w-full px-4 py-3 text-left flex items-center space-x-3 ${
                              active ? 'bg-gray-50 dark:bg-gray-700' : ''
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
                            className={`w-full px-4 py-3 text-left flex items-center space-x-3 ${
                              active ? 'bg-gray-50 dark:bg-gray-700' : ''
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
                placeholder={isLoading ? loadingText : placeholder}
                disabled={isLoading}
                className="flex-1 bg-transparent px-2 py-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none disabled:opacity-60"
              />

              {/* Voice Input Button */}
              <button type="button" className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Voice Input">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                  <path d="M19 10a7 7 0 01-14 0"/>
                  <path d="M12 19v4"/>
                </svg>
              </button>

              {/* Send Button */}
              <button
                type="submit"
                disabled={isLoading || value.trim().length === 0}
                className="p-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-40"
                title="Send"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13"/>
                    <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                  </svg>
                )}
              </button>
            </div>
          </form>

          {/* Footer Text */}
          <p className="text-center text-xs text-gray-400 py-2">
            {currentMode === 'agent' ? 'SLAR agent can make mistakes. Check important info.' : 'Simple chat mode - responses are generated locally.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
