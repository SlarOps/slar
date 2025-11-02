import { memo, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Badge } from './Badge';
import { statusColor, severityColor } from './utils';

// Utility to summarize large tool execution results
const summarizeToolResult = (content, maxLength = 300) => {
  if (!content || typeof content !== 'string') return { summary: '', full: content, needsSummary: false };

  // If content is short enough, no summary needed
  if (content.length <= maxLength) {
    return { summary: content, full: content, needsSummary: false };
  }

  // Try to parse as JSON to provide structured summary
  try {
    const parsed = JSON.parse(content);

    // Handle objects with 'items' array (kubectl responses)
    if (parsed.items && Array.isArray(parsed.items)) {
      const itemCount = parsed.items.length;

      // Get unique values for common fields
      const getUnique = (field) => [...new Set(parsed.items.map(item => item[field]).filter(Boolean))];

      const namespaces = getUnique('namespace');
      const statuses = getUnique('status');
      const kinds = getUnique('kind');

      let summary = `**${itemCount} item${itemCount !== 1 ? 's' : ''} returned**\n\n`;

      if (kinds.length > 0) summary += `**Type:** ${kinds.join(', ')}\n`;
      if (namespaces.length > 0) summary += `**Namespace:** ${namespaces.join(', ')}\n`;
      if (statuses.length > 0) summary += `**Status:** ${statuses.join(', ')}\n`;

      return {
        summary: summary + `\n*Click "Show Full Result" to see all ${itemCount} items*`,
        full: content,
        needsSummary: true,
        count: itemCount,
        itemType: 'items'
      };
    }

    // Handle plain array responses
    if (Array.isArray(parsed)) {
      const itemCount = parsed.length;
      const summary = `**${itemCount} item${itemCount !== 1 ? 's' : ''} returned**\n\n*Click "Show Full Result" to see all items*`;

      return {
        summary,
        full: content,
        needsSummary: true,
        count: itemCount,
        itemType: 'items'
      };
    }

    // Handle object responses
    if (typeof parsed === 'object' && parsed !== null) {
      const keys = Object.keys(parsed);

      // Show a few key fields if object is small-ish
      if (keys.length <= 10) {
        const preview = keys.slice(0, 3).map(k => {
          const val = JSON.stringify(parsed[k]).substring(0, 30);
          return `**${k}:** ${val}${JSON.stringify(parsed[k]).length > 30 ? '...' : ''}`;
        }).join('\n');

        return {
          summary: `**Object with ${keys.length} field${keys.length !== 1 ? 's' : ''}**\n\n${preview}${keys.length > 3 ? `\n\n*... and ${keys.length - 3} more fields*` : ''}`,
          full: content,
          needsSummary: true,
          count: keys.length,
          itemType: 'fields'
        };
      }

      return {
        summary: `**Object with ${keys.length} fields**\n\n*Click "Show Full Result" to see all fields*`,
        full: content,
        needsSummary: true,
        count: keys.length,
        itemType: 'fields'
      };
    }
  } catch (e) {
    // Not JSON, treat as plain text
  }

  // For plain text, show first N characters
  const truncated = content.substring(0, maxLength);
  const lastNewline = truncated.lastIndexOf('\n');
  const summary = lastNewline > maxLength * 0.5 ? truncated.substring(0, lastNewline) : truncated;

  return {
    summary: summary + '\n\n*...(truncated) - Click "Show Full Result" to see more*',
    full: content,
    needsSummary: true
  };
};

// Memoized Message Component để tránh re-render không cần thiết
const MessageComponent = memo(({ message, onRegenerate, onApprove, onDeny, pendingApprovalId }) => {
  // State for expandable tool results and thought
  const [isToolResultExpanded, setIsToolResultExpanded] = useState(false);
  const [isThoughtExpanded, setIsThoughtExpanded] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Memoize tool result summary
  const toolResultData = useMemo(() => {
    if ((message.type === 'tool_result' || message.type === 'ToolCallExecutionEvent') && message.content) {
      return summarizeToolResult(message.content);
    }
    return null;
  }, [message.type, message.content]);

  const markdownComponents = useMemo(() => ({
    p: ({ node, ...props }) => (
      <p className="my-3 leading-relaxed" {...props} />
    ),
    ul: ({ node, ...props }) => (
      <ul className="my-2 list-disc" {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="my-2 list-decimal pl-5" {...props} />
    ),
    li: ({ node, ...props }) => (
      <li className="my-1" {...props} />
    ),
    a: ({ node, ...props }) => (
      <a className="underline hover:no-underline" {...props} />
    ),
    pre: ({ node, ...props }) => (
      <pre className="my-3 rounded bg-gray-100 dark:bg-gray-900 overflow-x-auto" {...props} />
    ),
    h1: ({ node, ...props }) => (
      <h1 className="text-lg font-semibold mt-3 mb-2" {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-base font-semibold mt-3 mb-2" {...props} />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote className="border-l-4 border-gray-300 dark:border-gray-700 pl-3 my-3 text-gray-600 dark:text-gray-300" {...props} />
    ),
    table: ({ node, ...props }) => (
      <table className="my-3 w-full border-collapse" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th className="border px-2 py-1 text-left bg-gray-50 dark:bg-gray-800" {...props} />
    ),
    td: ({ node, ...props }) => (
      <td className="border px-2 py-1 align-top" {...props} />
    ),
  }), []);

  // Handle copy to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle regenerate
  const handleRegenerate = () => {
    if (onRegenerate) {
      onRegenerate(message);
    }
  };

  // Render different message types
  const renderMessageContent = () => {
    // Tool use message
    if (message.type === 'tool_use') {
      try {
        const toolData = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
        return (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 my-2">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">Tool: {toolData.name}</span>
            </div>
            <pre className="text-xs bg-white dark:bg-gray-900 p-2 rounded overflow-x-auto">
              {JSON.stringify(toolData.input, null, 2)}
            </pre>
          </div>
        );
      } catch (e) {
        return <div className="text-sm italic text-gray-500">Tool execution...</div>;
      }
    }

    // Tool result message with summary/expand
    if (message.type === 'tool_result' && toolResultData) {
      const displayContent = isToolResultExpanded ? toolResultData.full : toolResultData.summary;

      return (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 my-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium text-green-900 dark:text-green-100">Tool Result</span>
            </div>
            {toolResultData.needsSummary && (
              <button
                onClick={() => setIsToolResultExpanded(!isToolResultExpanded)}
                className="text-xs text-green-600 dark:text-green-400 hover:underline"
              >
                {isToolResultExpanded ? 'Show Summary' : 'Show Full Result'}
              </button>
            )}
          </div>
          <div className="text-sm">
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {displayContent}
            </Markdown>
          </div>
        </div>
      );
    }

    // Permission request message - inline approval UI
    if (message.type === 'permission_request') {
      // Parse tool info from message content
      let toolName = 'Unknown Tool';
      let toolInput = {};

      try {
        // Try to extract from message content structure
        if (message.tool_name) {
          toolName = message.tool_name;
        }
        if (message.tool_input) {
          toolInput = message.tool_input;
        }

        // Also parse from markdown content if available
        const match = message.content?.match(/Tool: `([^`]+)`/);
        if (match) {
          toolName = match[1];
        }
        const jsonMatch = message.content?.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          toolInput = JSON.parse(jsonMatch[1]);
        }
      } catch (e) {
        console.error('Error parsing tool info:', e);
      }

      const isPending = message.approval_id === pendingApprovalId;

      return (
        <div className="shadow-sm  rounded-lg p-3 my-2">
          <div className="flex items-start gap-3">
            {/* Warning icon */}
            <div className="flex-shrink-0 mt-1">
              
            </div>

            <div className="flex-1">
              {/* Title */}
              <h5 className="text-base font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                Tool Execution Approval Required
              </h5>

              {/* Description */}
              {/* <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
                Claude wants to execute the following tool. Please review and approve or deny.
              </p> */}

              {/* Tool details */}
              <div className="bg-white dark:bg-gray-900 rounded-md p-1 space-y-2">
                <div>
                  <p className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                    {toolName}
                  </p>
                </div>

                {toolInput && Object.keys(toolInput).length > 0 && (
                  <div>
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      components={markdownComponents}
                    >
                      {JSON.stringify(toolInput, null, 2)}
                    </Markdown>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {isPending && onApprove && onDeny ? (
                <div className="flex gap-3">
                  <button
                    onClick={() => onDeny(message.approval_id)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Deny
                  </button>
                  <button
                    onClick={() => onApprove(message.approval_id)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Approve & Execute
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs italic">
                  {message.approved ? (
                    <>
                      <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-green-600 dark:text-green-400">Approved</span>
                    </>
                  ) : message.denied ? (
                    <>
                      <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-red-600 dark:text-red-400">Denied</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-gray-500 dark:text-gray-400">Waiting for response...</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Interrupted message
    if (message.type === 'interrupted') {
      return (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3 my-2 text-orange-900 dark:text-orange-100">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
            </svg>
            <span className="text-sm font-medium">Task interrupted by user</span>
          </div>
        </div>
      );
    }

    // Error message
    if (message.type === 'error') {
      return (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 my-2 text-red-900 dark:text-red-100">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm">{message.content}</span>
          </div>
        </div>
      );
    }

    // Default text message
    return (
      <div className="relative">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {message.content}
        </Markdown>
      </div>
    );
  };

  return (
    <div className={`mb-6 ${message.role === "user" ? "text-right" : "text-left"}`}>
      <div
        className={`${message.role === "user" ? "inline-block" : "block"} rounded-3xl px-4 text-md leading-relaxed ${
          message.role === "user"
            ? "bg-gray-100 text-gray-800"
            : " dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        }`}
      >
        {/* Thought display - expandable */}
        {message.role !== "user" && message.thought && (
          <div className="mb-2 pt-2">
            <button
              onClick={() => setIsThoughtExpanded(!isThoughtExpanded)}
              className="text-xs text-gray-500 dark:text-gray-400 italic hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
            >
              <span>💭</span>
              <span>{isThoughtExpanded ? message.thought : `${message.thought.substring(0, 60)}...`}</span>
              {message.thought.length > 60 && (
                <svg className={`w-3 h-3 transition-transform ${isThoughtExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>
          </div>
        )}

        {/* Message content */}
        {renderMessageContent()}
      </div>

      {/* Action buttons - only for assistant messages */}
      {message.role !== "user" && message.type !== 'permission_request' && (
        <div className="mt-2 flex items-center gap-3 text-gray-400">
          <button
            onClick={handleCopy}
            title={copySuccess ? "Copied!" : "Copy"}
            className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {copySuccess ? (
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            )}
          </button>
          {onRegenerate && (
            <button
              onClick={handleRegenerate}
              title="Regenerate"
              className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 10-3.51 7.06"/>
                <path d="M21 12h-4"/>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

MessageComponent.displayName = 'MessageComponent';

export default MessageComponent;
