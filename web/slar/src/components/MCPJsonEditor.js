'use client';

import { useState, useEffect } from 'react';

/**
 * Simple JSON Editor Component with validation
 */
export default function MCPJsonEditor({ value, onChange, onSave, isSaving }) {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    if (value) {
      setJsonText(JSON.stringify(value, null, 2));
      setError('');
      setIsValid(true);
    }
  }, [value]);

  const handleChange = (e) => {
    const newText = e.target.value;
    setJsonText(newText);

    // Validate JSON
    try {
      const parsed = JSON.parse(newText);
      setError('');
      setIsValid(true);

      // Validate MCP structure
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        setError('Invalid MCP structure: missing or invalid "mcpServers" field');
        setIsValid(false);
        return;
      }

      // Notify parent of valid change
      if (onChange) {
        onChange(parsed);
      }
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
      setIsValid(false);
    }
  };

  const handleSave = () => {
    if (isValid && onSave) {
      try {
        const parsed = JSON.parse(jsonText);
        onSave(parsed);
      } catch (err) {
        setError(`Cannot save: ${err.message}`);
      }
    }
  };

  const handleFormat = () => {
    if (isValid) {
      try {
        const parsed = JSON.parse(jsonText);
        setJsonText(JSON.stringify(parsed, null, 2));
      } catch (err) {
        // Already handled in validation
      }
    }
  };

  const handleReset = () => {
    if (value) {
      setJsonText(JSON.stringify(value, null, 2));
      setError('');
      setIsValid(true);
    }
  };

  return (
    <div className="space-y-3">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            MCP Servers Configuration
          </span>
          {isValid ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              Valid
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
              Invalid
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleFormat}
            disabled={!isValid}
            className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded transition-colors disabled:opacity-50"
          >
            Format
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* JSON Editor */}
      <div className="relative">
        <textarea
          value={jsonText}
          onChange={handleChange}
          className={`w-full h-96 px-3 py-2 font-mono text-sm border rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y ${
            isValid
              ? 'border-gray-300 dark:border-gray-600'
              : 'border-red-300 dark:border-red-600'
          }`}
          spellCheck={false}
        />
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isValid || isSaving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving MCP Config...' : 'Save MCP Configuration'}
        </button>
      </div>

      {/* Help Text */}
      <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
          <strong>MCP Configuration Structure:</strong>
        </p>
        <pre className="text-xs text-gray-700 dark:text-gray-300 overflow-x-auto">
{`{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@package/name"],
      "env": {}
    }
  }
}`}
        </pre>
      </div>
    </div>
  );
}
