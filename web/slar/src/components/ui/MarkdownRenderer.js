'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

/**
 * MarkdownRenderer component
 * 
 * A reusable component for rendering markdown content with consistent styling
 * across the application. Automatically removes %%% markers from Datadog alerts.
 * 
 * @param {string} content - The markdown content to render
 * @param {string} className - Additional CSS classes to apply
 * @param {string} size - Size variant: 'sm', 'base', 'lg' (default: 'base')
 * @param {boolean} removePercents - Whether to remove %%% markers (default: true)
 */
export default function MarkdownRenderer({
  content,
  className = '',
  size = 'base',
  removePercents = true
}) {
  if (!content) return null;

  // Remove %%% markers from content (common in Datadog alerts)
  const processedContent = removePercents
    ? content.replace(/^%%%\s*/gm, '').replace(/\s*%%%$/gm, '')
    : content;

  // Size-based styling configurations
  const sizeConfig = {
    sm: {
      prose: 'prose-sm',
      p: 'my-1 leading-relaxed break-words',
      ul: 'my-1 list-disc pl-4 break-words',
      ol: 'my-1 list-decimal pl-4 break-words',
      li: 'my-0.5',
      pre: 'my-2 rounded bg-gray-100 dark:bg-gray-900 overflow-x-auto p-2 text-xs max-w-full',
      code: 'bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs break-all',
      h1: 'text-sm font-semibold mt-2 mb-1 break-words',
      h2: 'text-sm font-semibold mt-2 mb-1 break-words',
      h3: 'text-xs font-semibold mt-1 mb-0.5 break-words',
      blockquote: 'border-l-2 border-gray-300 dark:border-gray-700 pl-2 my-2 break-words',
      table: 'my-2 w-full border-collapse text-xs',
      th: 'border px-1 py-0.5 text-left bg-gray-50 dark:bg-gray-800',
      td: 'border px-1 py-0.5 align-top',
    },
    base: {
      prose: 'prose-sm',
      p: 'my-2 leading-relaxed break-words',
      ul: 'my-2 list-disc pl-5 break-words',
      ol: 'my-2 list-decimal pl-5 break-words',
      li: 'my-1',
      pre: 'my-3 rounded bg-gray-100 dark:bg-gray-900 overflow-x-auto p-3 max-w-full',
      code: 'bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs break-all',
      h1: 'text-lg font-semibold mt-3 mb-2 break-words',
      h2: 'text-base font-semibold mt-3 mb-2 break-words',
      h3: 'text-sm font-semibold mt-2 mb-1 break-words',
      blockquote: 'border-l-4 border-gray-300 dark:border-gray-700 pl-3 my-3 break-words',
      table: 'my-3 w-full border-collapse',
      th: 'border px-2 py-1 text-left bg-gray-50 dark:bg-gray-800',
      td: 'border px-2 py-1 align-top',
    },
    lg: {
      prose: 'prose',
      p: 'my-3 leading-relaxed break-words',
      ul: 'my-3 list-disc pl-6 break-words',
      ol: 'my-3 list-decimal pl-6 break-words',
      li: 'my-1.5',
      pre: 'my-4 rounded bg-gray-100 dark:bg-gray-900 overflow-x-auto p-4 max-w-full',
      code: 'bg-gray-100 dark:bg-gray-800 px-1.5 py-1 rounded text-sm break-all',
      h1: 'text-xl font-semibold mt-4 mb-3 break-words',
      h2: 'text-lg font-semibold mt-4 mb-2 break-words',
      h3: 'text-base font-semibold mt-3 mb-2 break-words',
      blockquote: 'border-l-4 border-gray-300 dark:border-gray-700 pl-4 my-4 break-words',
      table: 'my-4 w-full border-collapse',
      th: 'border px-3 py-2 text-left bg-gray-50 dark:bg-gray-800',
      td: 'border px-3 py-2 align-top',
    },
  };

  const config = sizeConfig[size] || sizeConfig.base;

  return (
    <div className={`prose ${config.prose} dark:prose-invert max-w-none ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ node, ...props }) => (
            <p className={config.p} {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className={config.ul} {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className={config.ol} {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className={config.li} {...props} />
          ),
          a: ({ node, ...props }) => (
            <a className="text-blue-600 dark:text-blue-400 hover:underline" {...props} />
          ),
          pre: ({ node, ...props }) => (
            <pre className={config.pre} {...props} />
          ),
          code: ({ node, inline, ...props }) => (
            inline ?
              <code className={config.code} {...props} /> :
              <code {...props} />
          ),
          h1: ({ node, ...props }) => (
            <h1 className={config.h1} {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className={config.h2} {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className={config.h3} {...props} />
          ),
          h4: ({ node, ...props }) => (
            <h4 className="text-sm font-semibold mt-2 mb-1" {...props} />
          ),
          h5: ({ node, ...props }) => (
            <h5 className="text-xs font-semibold mt-1 mb-0.5" {...props} />
          ),
          h6: ({ node, ...props }) => (
            <h6 className="text-xs font-semibold mt-1 mb-0.5" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className={`${config.blockquote} text-gray-600 dark:text-gray-300`} {...props} />
          ),
          table: ({ node, ...props }) => (
            <table className={config.table} {...props} />
          ),
          th: ({ node, ...props }) => (
            <th className={config.th} {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className={config.td} {...props} />
          ),
          hr: ({ node, ...props }) => (
            <hr className="my-4 border-gray-300 dark:border-gray-700" {...props} />
          ),
          img: ({ node, alt, ...props }) => (
            <img className="rounded-lg my-3 max-w-full h-auto" alt={alt || ''} {...props} />
          ),
        }}
      >
        {processedContent}
      </Markdown>
    </div>
  );
}

