import { memo, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Badge } from './Badge';
import { statusColor, severityColor, formatToolCall, generatePermissionPattern } from './utils';

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
const MessageComponent = memo(({ message, onRegenerate, onApprove, onApproveAlways, onDeny, pendingApprovals = [] }) => {
  // Debug log
  console.log('[MessageComponent] Rendering:', {
    role: message.role,
    type: message.type,
    contentLen: message.content?.length || 0,
    hasThought: !!message.thought
  });

  // State for expandable tool results and thought
  const [isToolResultExpanded, setIsToolResultExpanded] = useState(false);
  const [isThoughtExpanded, setIsThoughtExpanded] = useState(false);
  const [isToolContentExpanded, setIsToolContentExpanded] = useState(false);
  const [isPermissionContentExpanded, setIsPermissionContentExpanded] = useState(false);
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
      <p className="text-left last:mb-0 break-words" {...props} />
    ),
    ul: ({ node, ...props }) => (
      <ul className="ml-6 list-disc" {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="ml-6 list-decimal" {...props} />
    ),
    li: ({ node, ...props }) => (
      <li className="break-words" {...props} />
    ),
    a: ({ node, ...props }) => (
      <a className="underline hover:no-underline break-all" {...props} />
    ),
    pre: ({ node, ...props }) => (
      <pre className="rounded bg-gray-100 dark:bg-gray-900 overflow-x-auto max-w-full text-[0.95rem]" {...props} />
    ),
    code: ({ node, inline, className, children, ...props }) => {
      // Inline code (not in pre block)
      if (inline) {
        return (
          <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[0.9em] font-mono break-all" {...props}>
            {children}
          </code>
        );
      }
      // Code block (inside pre)
      return (
        <code className={`${className || ''} block overflow-x-auto`} {...props}>
          {children}
        </code>
      );
    },
    h1: ({ node, ...props }) => (
      <h1 className="text-[17px] font-semibold mb-4 mt-8 break-words" {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-[17px] font-semibold mb-3 mt-6 break-words" {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 className="text-[17px] font-semibold mb-2 mt-5 break-words" {...props} />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote className="border-l-4 border-gray-300 dark:border-gray-700 pl-3 my-3 text-gray-600 dark:text-gray-300" {...props} />
    ),
    table: ({ node, ...props }) => (
      <div className="overflow-x-auto my-2">
        <table className="w-full border-collapse min-w-max" {...props} />
      </div>
    ),
    th: ({ node, ...props }) => (
      <th className="border px-2 py-1 text-left bg-gray-50 dark:bg-gray-800 whitespace-nowrap" {...props} />
    ),
    td: ({ node, ...props }) => (
      <td className="border px-2 py-1 align-top break-words max-w-xs" {...props} />
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
    // Tool use message - Claude Code style format with expandable content
    if (message.type === 'tool_use') {
      try {
        const toolData = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
        const formattedCall = formatToolCall(toolData.name, toolData.input);
        const toolName = toolData.name;
        const toolInput = toolData.input || {};

        // Check if tool has content to display (Write, Edit, Bash, etc.)
        const hasContent = ['Write', 'Edit', 'Bash', 'Grep', 'Glob'].includes(toolName);
        const contentToShow = toolName === 'Write' || toolName === 'Edit'
          ? toolInput.content || toolInput.new_string
          : toolName === 'Bash'
            ? toolInput.command
            : toolName === 'Grep' || toolName === 'Glob'
              ? toolInput.pattern
              : null;

        // Determine language for syntax highlighting
        const getLanguage = () => {
          if (toolName === 'Bash') return 'bash';
          if (toolName === 'Grep' || toolName === 'Glob') return 'text';
          const filePath = toolInput.file_path || '';
          if (filePath.endsWith('.py')) return 'python';
          if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
          if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
          if (filePath.endsWith('.go')) return 'go';
          if (filePath.endsWith('.json')) return 'json';
          if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return 'yaml';
          if (filePath.endsWith('.md')) return 'markdown';
          if (filePath.endsWith('.sql')) return 'sql';
          if (filePath.endsWith('.sh')) return 'bash';
          return 'text';
        };

        return (
          <div className="my-2">
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded">
                {formattedCall}
              </code>
              {hasContent && contentToShow && (
                <button
                  onClick={() => setIsToolContentExpanded(!isToolContentExpanded)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {isToolContentExpanded ? 'Hide' : 'Show'} content
                </button>
              )}
            </div>
            {hasContent && contentToShow && isToolContentExpanded && (
              <div className="mt-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {toolInput.file_path || toolName}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {contentToShow.split('\n').length} lines
                  </span>
                </div>
                <pre className="p-3 overflow-x-auto text-sm max-h-96 overflow-y-auto">
                  <code className={`language-${getLanguage()}`}>
                    {contentToShow}
                  </code>
                </pre>
              </div>
            )}
          </div>
        );
      } catch (e) {
        return <div className="text-sm italic text-gray-500">Tool execution...</div>;
      }
    }

    // Tool result message with summary/expand
    if (message.type === 'tool_result' && toolResultData) {
      const displayContent = isToolResultExpanded ? toolResultData.full : toolResultData.summary;

      // Check if content looks like plain text output (not JSON/markdown)
      const isPlainTextOutput = !displayContent.startsWith('{') &&
                                !displayContent.startsWith('[') &&
                                !displayContent.startsWith('#') &&
                                !displayContent.startsWith('*');

      return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
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
          <div className="p-3 overflow-x-auto max-h-96 overflow-y-auto bg-gray-900 text-gray-100">
            {isPlainTextOutput ? (
              /* Plain text output (like kubectl, ls, etc.) - preserve formatting */
              <pre className="text-sm font-mono whitespace-pre-wrap leading-relaxed">
                {displayContent}
              </pre>
            ) : (
              /* JSON/Markdown content - render with Markdown */
              <div className="text-sm">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={markdownComponents}
                >
                  {displayContent}
                </Markdown>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Permission request message - inline approval UI with Claude Code style format
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

      const isPending = pendingApprovals.some(a => a.request_id === message.request_id);
      const formattedCall = formatToolCall(toolName, toolInput);
      const permissionPattern = generatePermissionPattern(toolName, toolInput);

      // Check if tool has content to display
      const hasContent = ['Write', 'Edit', 'Bash', 'Grep', 'Glob'].includes(toolName);
      const contentToShow = toolName === 'Write' || toolName === 'Edit'
        ? toolInput.content || toolInput.new_string
        : toolName === 'Bash'
          ? toolInput.command
          : toolName === 'Grep' || toolName === 'Glob'
            ? toolInput.pattern
            : null;

      // Determine language for syntax highlighting
      const getLanguage = () => {
        if (toolName === 'Bash') return 'bash';
        if (toolName === 'Grep' || toolName === 'Glob') return 'text';
        const filePath = toolInput.file_path || '';
        if (filePath.endsWith('.py')) return 'python';
        if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
        if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
        if (filePath.endsWith('.go')) return 'go';
        if (filePath.endsWith('.json')) return 'json';
        if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return 'yaml';
        if (filePath.endsWith('.md')) return 'markdown';
        if (filePath.endsWith('.sql')) return 'sql';
        if (filePath.endsWith('.sh')) return 'bash';
        return 'text';
      };

      return (
        <div className="rounded-lg my-2">
          <div className="">
            <div className="flex-1">
              {/* Tool details - Claude Code style */}
              <div className="dark:bg-gray-900 rounded-md space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm font-mono text-yellow-700 dark:text-yellow-300 dark:bg-yellow-900/30 px-2 py-1 rounded break-all">
                    {formattedCall}
                  </code>
                  {hasContent && contentToShow && (
                    <button
                      onClick={() => setIsPermissionContentExpanded(!isPermissionContentExpanded)}
                      className="text-xs text-yellow-600 dark:text-yellow-400 hover:underline"
                    >
                      {isPermissionContentExpanded ? 'Hide' : 'Show'} content
                    </button>
                  )}
                </div>
                {/* Expandable content preview */}
                {hasContent && contentToShow && isPermissionContentExpanded && (
                  <div className="mt-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {toolInput.file_path || toolName}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {contentToShow.split('\n').length} lines
                      </span>
                    </div>
                    <pre className="p-3 overflow-x-auto text-sm max-h-64 overflow-y-auto">
                      <code className={`language-${getLanguage()}`}>
                        {contentToShow}
                      </code>
                    </pre>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {isPending && onApprove && onDeny ? (
                <div className="flex flex-row gap-2 mt-2">
                  <button
                    onClick={() => onDeny(message.request_id)}
                    className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    title="Deny"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span>Deny</span>
                  </button>
                  <button
                    onClick={() => onApprove(message.request_id)}
                    className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 border border-transparent hover:bg-blue-700 transition-colors shadow-sm"
                    title="Approve once"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Approve</span>
                  </button>

                  {onApproveAlways && (
                    <button
                      onClick={() => onApproveAlways(message.request_id, permissionPattern)}
                      className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                      title={`Always allow: ${permissionPattern}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Always Allow</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs italic p-1">
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

    // Thinking message (empty content but has thought) - render placeholder
    if (message.type === 'thinking' && (!message.content || message.content.trim() === '')) {
      // Just return null since thought is rendered above
      return null;
    }

    // Default text message
    console.log('[MessageComponent] Rendering default text, content:', message.content?.substring(0, 50));
    return (
      <div className="relative overflow-hidden">
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
    <div className={`mb-2 ${message.role === "user" ? "text-right" : "text-left"}`}>
      <div
        className={`${message.role === "user" ? "inline-block max-w-[85%] sm:max-w-[80%]" : "block max-w-full overflow-hidden"} rounded-2xl p-2 sm:px-4 text-[17px] leading-[1.75] ${message.role === "user"
          ? "bg-gray-100 text-gray-800 border"
          : "dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          }`}
      >
        {/* Thought display - expandable */}
        {message.role !== "user" && message.thought && (
          <div className="mb-2 pt-2">
            <div
              onClick={() => setIsThoughtExpanded(!isThoughtExpanded)}
              className="text-xs text-gray-500 dark:text-gray-400 italic hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
            >
              <span>{isThoughtExpanded ? message.thought : `${message.thought.substring(0, 60)}...`}</span>
              {message.thought.length > 60 && (
                <svg className={`w-3 h-3 transition-transform ${isThoughtExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </div>
          </div>
        )}

        {/* Message content */}
        {renderMessageContent()}
      </div>

      {/* Action buttons - only for assistant messages */}
      {message.role !== "user" && message.type !== 'permission_request' && (
        <div className="mt-2 flex items-center text-gray-400">
          <button
            onClick={handleCopy}
            title={copySuccess ? "Copied!" : "Copy"}
            className="p-2 sm:p-1 hover:text-gray-600 dark:hover:text-gray-300 transition-colors touch-manipulation"
          >
            {copySuccess ? (
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
          {onRegenerate && (
            <button
              onClick={handleRegenerate}
              title="Regenerate"
              className="p-2 sm:p-1 hover:text-gray-600 dark:hover:text-gray-300 transition-colors touch-manipulation"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 10-3.51 7.06" />
                <path d="M21 12h-4" />
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
