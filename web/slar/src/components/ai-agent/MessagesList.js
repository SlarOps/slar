import { memo, useMemo } from 'react';
import MessageComponent from './MessageComponent';

const MessagesList = memo(({ messages, isSending, endRef, onRegenerate, onApprove, onDeny, pendingApprovalId }) => {
  // Tối ưu hóa: chỉ render một số lượng messages nhất định để tránh lag
  const MAX_VISIBLE_MESSAGES = 50;
  const visibleMessages = useMemo(() => {
    if (messages.length <= MAX_VISIBLE_MESSAGES) {
      return messages;
    }
    // Giữ lại một vài messages đầu và hiển thị messages gần đây nhất
    const recentMessages = messages.slice(-MAX_VISIBLE_MESSAGES + 5);
    const firstFewMessages = messages.slice(0, 5);
    
    return [
      ...firstFewMessages,
      { 
        role: "assistant", 
        content: `... (${messages.length - MAX_VISIBLE_MESSAGES} messages cũ hơn đã được ẩn để tối ưu hiệu suất) ...`,
        type: "system_info"
      },
      ...recentMessages
    ];
  }, [messages]);

  return (
    <main
      className="flex-1 overflow-y-auto scroll-smooth pb-24 sm:pb-28 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
        {visibleMessages.map((message, idx) => (
          <MessageComponent
            key={`${message.role}-${idx}-${message.content?.slice(0, 50) || ''}`}
            message={message}
            onRegenerate={onRegenerate}
            onApprove={onApprove}
            onDeny={onDeny}
            pendingApprovalId={pendingApprovalId}
          />
        ))}

        {/* Typing indicator when AI is responding */}
        {isSending && (
          <div className="mb-6 text-left">
            <div className="inline-block max-w-[85%] rounded-2xl px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800">
              <div className="flex items-center gap-2 text-gray-500">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-xs">thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </main>
  );
});

MessagesList.displayName = 'MessagesList';

export default MessagesList;
