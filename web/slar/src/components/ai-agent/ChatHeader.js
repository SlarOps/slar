import { memo } from 'react';

const ChatHeader = memo(() => {
  return (
    <header className="bg-white dark:bg-gray-800 dark:border-gray-700 px-2 sm:px-4 py-2 sm:py-3">
      <div className="max-w-3xl mx-auto">
        {/* Header can be used for title or other info if needed */}
      </div>
    </header>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;
