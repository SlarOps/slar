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
const MessageComponent = memo(({ message }) => {
  // State for expandable tool results
  const [isToolResultExpanded, setIsToolResultExpanded] = useState(false);

  // Memoize tool result summary
  const toolResultData = useMemo(() => {
    if (message.type === 'ToolCallExecutionEvent' && message.content) {
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

  return (
    <div className={`mb-6 ${message.role === "user" ? "text-right" : "text-left"}`}>
      <div
        className={`${message.role === "user" ? "inline-block" : "block"} rounded-3xl px-4 text-md leading-relaxed ${
          message.role === "user"
            ? "bg-gray-100 text-gray-800"
            : " dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        }`}
      >
        <div>
          {message.role !== "user" && (message.content || message.thought) ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color="bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
                {message.source}
              </Badge>
              {message.thought && (
                <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                  💭 {message.thought.substring(0, 40)}...
                </span>
              )}
            </div>
          ) : null}
        {message.type === 'MemoryQueryEvent' && (
          <div className="mt-1">
            <Badge color="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
              🔍 Memory Query
            </Badge>
          </div>
        )}
        {message.type === 'ToolCallRequestEvent' && (
          <div className="mt-1">
            <Badge color="bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
              ⚡ Tool Call Request
            </Badge>
          </div>
        )}
        {message.type === 'ToolCallExecutionEvent' && (
          <div className="mt-1">
            <Badge color="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300">
              🔧 Tool Execution
            </Badge>
          </div>
        )}
        </div>
        
        {message.type === 'MemoryQueryEvent' && (
          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Knowledge Sources {message.originalContent && Array.isArray(message.originalContent) ? `(${message.originalContent.filter(item => item.metadata).length})` : ''}
              </span>
            </div>

            {message.originalContent && Array.isArray(message.originalContent) && (
              <div className="flex flex-wrap gap-2">
                {message.originalContent.filter(item => item.metadata).map((item, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm p-2 bg-white dark:bg-gray-800 rounded border min-w-0 max-w-xs flex-shrink-0">
                      {item.metadata.github_url ? (
                        <>
                          <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                          </svg>
                          <div className="flex-1 min-w-0">
                            <a
                              href={item.metadata.github_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline font-medium truncate block"
                              title={item.metadata.github_url}
                            >
                              📄 {item.metadata.path || item.metadata.github_url.split('/').pop()}
                            </a>
                            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {item.metadata.chunk_index !== undefined && (
                                <span>Chunk #{item.metadata.chunk_index}</span>
                              )}
                              {item.metadata.score !== undefined && (
                                <span>Relevance: {(item.metadata.score * 100).toFixed(1)}%</span>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <span className="text-gray-700 dark:text-gray-300 font-medium truncate block">
                              📄 {item.metadata.path || item.metadata.source}
                            </span>
                            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {item.metadata.chunk_index !== undefined && (
                                <span>Chunk #{item.metadata.chunk_index}</span>
                              )}
                              {item.metadata.score !== undefined && (
                                <span>Relevance: {(item.metadata.score * 100).toFixed(1)}%</span>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                ))}
              </div>
            )}
          </div>
        )}

        {message.type === 'ToolCallRequestEvent' && (
          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Tool Call Request
              </span>
            </div>
            <div className="rounded-lg overflow-x-auto">
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={markdownComponents}
              >
                {message.content}
              </Markdown>
            </div>
          </div>
        )}

        {message.type === 'ToolCallExecutionEvent' && (
          <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-green-800 dark:text-green-200">
                  Tool Execution Result
                  {toolResultData?.count && (
                    <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">
                      ({toolResultData.count} {toolResultData.itemType || 'items'})
                    </span>
                  )}
                </span>
              </div>
              {toolResultData?.needsSummary && (
                <button
                  onClick={() => setIsToolResultExpanded(!isToolResultExpanded)}
                  className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-700 transition-colors flex items-center gap-1"
                >
                  {isToolResultExpanded ? (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      Show Less
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      Show Full Result
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="rounded-lg overflow-x-auto">
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={markdownComponents}
              >
                {toolResultData?.needsSummary && !isToolResultExpanded
                  ? toolResultData.summary
                  : message.content}
              </Markdown>
            </div>
          </div>
        )}
        
        {message.type !== 'MemoryQueryEvent' && message.type !== 'ToolCallRequestEvent' && message.type !== 'ToolCallExecutionEvent' && (
        <div className="relative">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {message.content}
          </Markdown>
        </div>
        )}
      </div>

      {Array.isArray(message.incidents) && message.incidents.length > 0 && (
        <div className="mt-3 space-y-3">
          {message.incidents.map((inc) => (
            <div key={inc.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:bg-gray-50/60 dark:hover:bg-gray-800/60 cursor-pointer transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                    {inc.title || inc.name || `Incident ${inc.id}`}
                  </div>
                  {inc.description && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                      {inc.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge color={statusColor(inc.status)}>{inc.status || "unknown"}</Badge>
                  {(inc.severity || inc.urgency) && (
                    <Badge color={severityColor(inc.severity || inc.urgency)}>
                      {inc.severity || inc.urgency}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
                {inc.id && <span className="font-mono">#{inc.id.slice(0, 8)}</span>}
                {(inc.service_name || inc.service) && (
                  <span>Service: {inc.service_name || inc.service}</span>
                )}
                {inc.group && <span>Group: {inc.group}</span>}
                {(inc.assigned_to_name || inc.assignee) && (
                  <span>Assignee: {inc.assigned_to_name || inc.assignee}</span>
                )}
                {(inc.created_at || inc.updated_at || inc.updatedAt) && (
                  <span>
                    {inc.created_at ? `Created: ${new Date(inc.created_at).toLocaleDateString()}` :
                     inc.updated_at ? `Updated: ${new Date(inc.updated_at).toLocaleDateString()}` :
                     `Updated: ${inc.updatedAt}`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {message.role !== "user" && (
        <div className="mt-2 flex items-center gap-3 text-gray-400">
          <button title="Like" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 00-3-3l-1 5-4 4v9h11l2-8-5-3z"/></svg>
          </button>
          <button title="Dislike" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 003 3l1-5 4-4V4H7L5 12l5 3z"/></svg>
          </button>
          <button title="Copy" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button title="Regenerate" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 10-3.51 7.06"/><path d="M21 12h-4"/></svg>
          </button>
          <button title="More" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>
      )}
    </div>
  );
});

MessageComponent.displayName = 'MessageComponent';

export default MessageComponent;
