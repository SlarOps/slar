import { memo } from 'react';
import { SessionInfo } from './SessionInfo';

const ChatHeader = memo(({ connectionStatus, sessionId, onSessionReset }) => {
  return (
    <header className="bg-white dark:bg-gray-800 dark:border-gray-700 px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {/* Connection Status */}
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected' ? 'bg-green-500' :
                connectionStatus === 'connecting' ? 'bg-yellow-500' :
                connectionStatus === 'error' ? 'bg-red-500' :
                'bg-gray-400'
              }`}></div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {connectionStatus === 'connected' ? 'Connected' :
                 connectionStatus === 'connecting' ? 'Connecting...' :
                 connectionStatus === 'error' ? 'Connection Error' :
                 'Disconnected'}
              </span>
            </div>

            <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
              AI Agent Mode
            </span>
          </div>
          
          {/* Session Reset Button */}
          <SessionInfo 
            sessionId={sessionId} 
            onSessionReset={onSessionReset}
          />
        </div>
      </div>
    </header>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;
