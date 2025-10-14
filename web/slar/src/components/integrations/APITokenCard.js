'use client';

import { useState } from 'react';
import { Menu, MenuButton, MenuItems, MenuItem, Transition } from '@headlessui/react';

/**
 * APITokenCard - Card component for displaying API tokens/keys
 * @param {Object} props
 * @param {string} props.name - Token name/identifier
 * @param {string} props.token - The actual token value
 * @param {string} props.provider - Provider name (e.g., 'gemini', 'openai')
 * @param {boolean} props.isActive - Whether token is active
 * @param {Date|string} props.createdAt - When token was created
 * @param {Date|string} props.lastUsed - When token was last used
 * @param {function} props.onEdit - Edit callback
 * @param {function} props.onDelete - Delete callback
 * @param {function} props.onToggle - Toggle active status callback
 */
export default function APITokenCard({ 
  name, 
  token, 
  provider = 'gemini',
  isActive = true,
  createdAt,
  lastUsed,
  onEdit,
  onDelete,
  onToggle
}) {
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const maskToken = (token) => {
    if (!token) return '';
    if (token.length <= 8) return '••••••••';
    return `${token.slice(0, 4)}${'•'.repeat(20)}${token.slice(-4)}`;
  };

  const getProviderColor = (provider) => {
    const colors = {
      gemini: 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-900/30 dark:border-purple-800',
      openai: 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800',
      anthropic: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-800',
      default: 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700'
    };
    return colors[provider.toLowerCase()] || colors.default;
  };

  const formatDate = (date) => {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700">
            <svg className="h-5 w-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getProviderColor(provider)}`}>
                {provider.toUpperCase()}
              </span>
              <div className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                isActive
                  ? 'text-green-600 bg-green-100 dark:bg-green-900/30' 
                  : 'text-gray-600 bg-gray-100 dark:bg-gray-900/30'
              }`}>
                {isActive ? 'Active' : 'Inactive'}
              </div>
            </div>
          </div>
        </div>

        {/* Actions Menu */}
        <Menu as="div" className="relative">
          <MenuButton className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </MenuButton>

          <Transition
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <MenuItems className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 py-1">
              <MenuItem>
                {({ focus }) => (
                  <button
                    onClick={onEdit}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                      focus ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Token
                  </button>
                )}
              </MenuItem>
              <MenuItem>
                {({ focus }) => (
                  <button
                    onClick={onToggle}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                      focus ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {isActive ? '🔴 Deactivate' : '🟢 Activate'}
                  </button>
                )}
              </MenuItem>
              <hr className="border-gray-200 dark:border-gray-700 my-1" />
              <MenuItem>
                {({ focus }) => (
                  <button
                    onClick={onDelete}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                      focus ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Token
                  </button>
                )}
              </MenuItem>
            </MenuItems>
          </Transition>
        </Menu>
      </div>

      {/* Token Display */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">API Token</span>
          <button
            onClick={() => setShowToken(!showToken)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            {showToken ? (
              <>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
                Hide
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Show
              </>
            )}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
            {showToken ? token : maskToken(token)}
          </code>
          <button
            onClick={handleCopy}
            className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            title="Copy token"
          >
            {copied ? '✓' : '📋'}
          </button>
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="space-y-1">
          <div>Created: {formatDate(createdAt)}</div>
        </div>
        <div className="text-right">
          <div>Last used: {formatDate(lastUsed)}</div>
        </div>
      </div>
    </div>
  );
}

