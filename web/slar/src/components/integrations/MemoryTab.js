'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../ui';
import {
  DocumentTextIcon,
  ClockIcon,
  ArrowPathIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import {
  getMemoryFromDB,
  saveMemoryToDB,
  deleteMemoryFromDB
} from '../../lib/workspaceManager';

export default function MemoryTab() {
  const { session } = useAuth();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    loadMemory();
  }, [session]);

  const loadMemory = async () => {
    if (!session?.user?.id) return;

    setLoading(true);
    try {
      const result = await getMemoryFromDB(session.user.id);
      if (result.success) {
        setContent(result.content || '');
        setLastUpdated(result.updated_at);
        setHasUnsavedChanges(false);
      } else {
        toast.error('Failed to load memory');
      }
    } catch (error) {
      console.error('Failed to load memory:', error);
      toast.error('Failed to load memory');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!session?.user?.id) return;

    setSaving(true);
    try {
      const result = await saveMemoryToDB(session.user.id, content);
      if (result.success) {
        setLastUpdated(result.updated_at);
        setHasUnsavedChanges(false);
        toast.success('Memory saved successfully!');
      } else {
        toast.error('Failed to save memory');
      }
    } catch (error) {
      console.error('Failed to save memory:', error);
      toast.error('Failed to save memory');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Are you sure you want to delete all memory content?')) return;

    setSaving(true);
    try {
      const result = await deleteMemoryFromDB(session.user.id);
      if (result.success) {
        setContent('');
        setLastUpdated(null);
        setHasUnsavedChanges(false);
        toast.success('Memory cleared successfully!');
      } else {
        toast.error('Failed to clear memory');
      }
    } catch (error) {
      console.error('Failed to clear memory:', error);
      toast.error('Failed to clear memory');
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (e) => {
    setContent(e.target.value);
    setHasUnsavedChanges(true);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 sm:p-4 animate-pulse">
          <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3 sm:mb-4" />
          <div className="h-48 sm:h-64 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header with Info */}
      <div className="bg-blue-50/50 dark:bg-blue-900/20 rounded-lg p-3 sm:p-4">
        <div className="flex items-start gap-2 sm:gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <DocumentTextIcon className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xs sm:text-sm font-medium text-blue-900 dark:text-blue-100">
              AI Agent Memory (CLAUDE.md)
            </h3>
            <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 mt-1">
              This content will be available to your AI agent as context. Use it to store:
              important commands, cluster names, frequently used queries, team conventions, or any
              other information you want the AI to remember.
            </p>
            {lastUpdated && (
              <div className="flex items-center gap-1 sm:gap-2 mt-2 text-xs text-blue-600 dark:text-blue-400">
                <ClockIcon className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="truncate">Last updated: {formatDate(lastUpdated)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
            <DocumentTextIcon className="h-4 w-4 sm:h-5 sm:w-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
            <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              Memory Editor
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs text-orange-600 dark:text-orange-400 flex-shrink-0">
                (unsaved)
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 ml-2">
            <button
              onClick={loadMemory}
              disabled={saving}
              className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
              title="Reload"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </button>
            <button
              onClick={handleClear}
              disabled={saving || !content}
              className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
              title="Clear all"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Textarea */}
        <div className="p-3 sm:p-4">
          <textarea
            value={content}
            onChange={handleContentChange}
            rows={20}
            className="w-full px-2 sm:px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-xs sm:text-sm resize-y"
            placeholder="# Example Memory Content

## Datadog Query Examples
```datadog
avg:container.cpu.usage{kube_stateful_set:opensearch-hawk-nodes} by {datajet_cluster}
```

## Available Clusters
- opensearch-hawk
- opensearch-feeds
- opensearch-seer

## Team Conventions
- Always check staging before deploying to prod
- Use feature flags for new features
"
            spellCheck={false}
          />
        </div>

        {/* Footer with Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 px-3 sm:px-4 py-2 sm:py-3 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 rounded-b">
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left">
            {content.length} characters • Markdown supported
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !hasUnsavedChanges}
            className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-blue-600 text-white text-xs sm:text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Markdown Preview Tip */}
      <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
        <span>💡 Tip: Use Markdown formatting for better readability in your AI conversations</span>
      </div>
    </div>
  );
}
