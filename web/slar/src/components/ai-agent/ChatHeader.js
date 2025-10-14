import { memo } from 'react';
import { SessionInfo } from './SessionInfo';

const ChatHeader = memo(({ connectionStatus, sessionId, onSessionReset, mode, onModeChange }) => {
  return (
    <header className="bg-white dark:bg-gray-800 dark:border-gray-700 px-2 sm:px-4 py-2 sm:py-3">
      <div className="max-w-3xl mx-auto">
        {/* Single Row: Connection Status, Mode Toggle, and New Session */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Connection Status */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' :
              connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              connectionStatus === 'error' ? 'bg-red-500' :
              'bg-gray-400'
            }`}></div>
            <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {connectionStatus === 'connected' ? 'Connected' :
               connectionStatus === 'connecting' ? 'Connecting...' :
               connectionStatus === 'error' ? 'Connection Error' :
               'Disconnected'}
            </span>
          </div>

          {/* Center: Mode Toggle Buttons */}
          {onModeChange && (
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 flex-shrink-0">
              <button
                onClick={() => onModeChange('chat')}
                className={`px-2 sm:px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  mode === 'chat'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <span className="sm:hidden">💬</span>
                <span className="hidden sm:inline">💬 Chat</span>
              </button>
              <button
                onClick={() => onModeChange('terminal')}
                className={`px-2 sm:px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  mode === 'terminal'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <span className="sm:hidden">🖥️</span>
                <span className="hidden sm:inline">🖥️ Terminal</span>
              </button>
            </div>
          )}

          {/* Right: New Session Button */}
          <div className="flex-shrink-0">
            <SessionInfo 
              sessionId={sessionId} 
              onSessionReset={onSessionReset}
            />
          </div>
        </div>
      </div>
    </header>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;
