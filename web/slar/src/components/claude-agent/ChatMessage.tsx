/**
 * Chat Message Component for Claude Agent
 * ChatGPT-style UI with right-aligned user messages
 */

import React, { useState } from 'react';
import type { ChatMessage } from '@/types/claude-agent';
import {
  ClipboardDocumentIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  ArrowPathIcon,
  EllipsisHorizontalIcon,
  CheckIcon
} from '@heroicons/react/24/outline';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';

interface ChatMessageProps {
  message: ChatMessage;
  onRegenerate?: () => void;
}

export function ChatMessageComponent({ message, onRegenerate }: ChatMessageProps) {
  const isUser = message.type === 'user';
  const isError = message.type === 'error';
  const isToolResult = message.type === 'tool_result';
  const isToolUse = message.type === 'tool_use';
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState<boolean | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLike = () => {
    setLiked(liked === true ? null : true);
  };

  const handleDislike = () => {
    setLiked(liked === false ? null : false);
  };

  if (isUser) {
    return (
      <div className="w-full py-6 px-4">
        <div className="max-w-3xl mx-auto flex justify-end">
          <div className="bg-gray-100 dark:bg-gray-700 rounded-3xl px-5 py-3 max-w-[80%]">
            <p className="text-[17px] text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-[1.75]">
              {message.content}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full py-6 px-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 group">
      <div className="max-w-3xl mx-auto">
        {/* Message Content */}
        <div className="mb-3">
          {isError ? (
            <div className="text-[17px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-4 leading-[1.75]">
              {message.content}
            </div>
          ) : isToolResult ? (
            /* Tool result - preserve formatting with monospace font */
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto">
              <div className="text-xs text-gray-400 mb-2 font-sans">Tool Result</div>
              <pre className="text-[0.9rem] font-mono whitespace-pre-wrap leading-relaxed">
                {message.content}
              </pre>
            </div>
          ) : isToolUse ? (
            /* Tool use - show as collapsible JSON */
            <div className="bg-blue-900/30 text-blue-100 rounded-lg p-4 overflow-x-auto">
              <div className="text-xs text-blue-400 mb-2 font-sans">Tool Execution</div>
              <pre className="text-[0.85rem] font-mono whitespace-pre-wrap leading-relaxed">
                {message.content}
              </pre>
            </div>
          ) : (
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline && match ? (
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{
                          borderRadius: '0.5rem',
                          padding: '1rem',
                          fontSize: '0.95rem',
                        }}
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code
                        className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-[0.9em] font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  p({ children }) {
                    return <p className="mb-5 last:mb-0 text-[17px] leading-[1.75]">{children}</p>;
                  },
                  ul({ children }) {
                    return <ul className="mb-5 ml-6 list-disc space-y-2">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="mb-5 ml-6 list-decimal space-y-2">{children}</ol>;
                  },
                  li({ children }) {
                    return <li className="text-[17px] leading-[1.75]">{children}</li>;
                  },
                  h1({ children }) {
                    return <h1 className="text-[26px] font-semibold mb-4 mt-8">{children}</h1>;
                  },
                  h2({ children }) {
                    return <h2 className="text-[22px] font-semibold mb-3 mt-6">{children}</h2>;
                  },
                  h3({ children }) {
                    return <h3 className="text-[19px] font-semibold mb-2 mt-5">{children}</h3>;
                  },
                  strong({ children }) {
                    return <strong className="font-semibold">{children}</strong>;
                  },
                  pre({ children }) {
                    // Handle preformatted text (code blocks) with proper formatting
                    return (
                      <pre className="overflow-x-auto bg-gray-900 text-gray-100 rounded-lg p-4 my-4 text-[0.95rem] font-mono whitespace-pre-wrap">
                        {children}
                      </pre>
                    );
                  },
                }}
              >
                {message.content || '...'}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Action Buttons - Only show for assistant messages */}
        {!isError && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Copy message"
            >
              {copied ? (
                <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <ClipboardDocumentIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              )}
            </button>

            <button
              onClick={handleLike}
              className={`p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors ${
                liked === true ? 'bg-gray-200 dark:bg-gray-700' : ''
              }`}
              title="Good response"
            >
              <HandThumbUpIcon
                className={`w-4 h-4 ${
                  liked === true
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              />
            </button>

            <button
              onClick={handleDislike}
              className={`p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors ${
                liked === false ? 'bg-gray-200 dark:bg-gray-700' : ''
              }`}
              title="Bad response"
            >
              <HandThumbDownIcon
                className={`w-4 h-4 ${
                  liked === false
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              />
            </button>

            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Regenerate response"
              >
                <ArrowPathIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            )}

            <button
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="More options"
            >
              <EllipsisHorizontalIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
