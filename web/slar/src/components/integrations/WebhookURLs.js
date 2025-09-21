'use client';

import { useState, useEffect } from 'react';

const WEBHOOK_ENDPOINT = '/webhooks/alert';

export default function WebhookURLs({ apiKeys }) {
  const [selectedAPIKey, setSelectedAPIKey] = useState('');
  const [copiedURL, setCopiedURL] = useState('');

  const baseURL = process.env.NEXT_PUBLIC_API_URL || 'https://your-domain.com';

  // Auto-select first available API key when apiKeys change
  useEffect(() => {
    if (apiKeys && apiKeys.length > 0 && !selectedAPIKey) {
      const availableKeys = apiKeys.filter(key => key.is_active && key.permissions.includes('create_alerts'));
      if (availableKeys.length > 0) {
        setSelectedAPIKey(availableKeys[0].id);
      }
    }
  }, [apiKeys, selectedAPIKey]);

  const generateWebhookURL = (apiKeyId) => {
    if (!apiKeyId) return `${baseURL}${WEBHOOK_ENDPOINT}?api_key=YOUR_API_KEY`;
    
    // Find the selected API key to get its name for a helpful placeholder
    const selectedKey = apiKeys?.find(key => key.id === apiKeyId);
    if (selectedKey) {
      const placeholder = `YOUR_${selectedKey.name.toUpperCase().replace(/\s+/g, '_')}_API_KEY`;
      return `${baseURL}${WEBHOOK_ENDPOINT}?api_key=${placeholder}`;
    }
    
    return `${baseURL}${WEBHOOK_ENDPOINT}?api_key=${apiKeyId}`;
  };

  const copyToClipboard = async () => {
    const urlToCopy = generateWebhookURL(selectedAPIKey);
    
    try {
      await navigator.clipboard.writeText(urlToCopy);
      setCopiedURL(urlToCopy);
      setTimeout(() => setCopiedURL(''), 3000);
      
      // Show helpful message about placeholder
      if (urlToCopy.includes('YOUR_') && urlToCopy.includes('_API_KEY')) {
        console.log('URL copied with placeholder API key. Replace the placeholder with your actual API key value.');
      }
      
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const webhookURL = generateWebhookURL(selectedAPIKey);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Webhook URL</h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Send alerts to SLAR
        </span>
      </div>



      {/* Webhook URL Card */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Webhook Endpoint</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Send alerts from any monitoring system to SLAR</p>
            </div>
          </div>
          <span className="inline-flex px-2 py-1 text-xs font-medium rounded text-green-600 bg-green-100 dark:bg-green-900/30">
            POST
          </span>
        </div>

        {/* Webhook URL */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Webhook URL:</span>
            {!selectedAPIKey && apiKeys && apiKeys.length === 0 && (
              <span className="text-xs text-yellow-600 dark:text-yellow-400">Create an API key first</span>
            )}
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={webhookURL}
              readOnly
              className="flex-1 px-4 py-3 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <button
              onClick={copyToClipboard}
              className={`px-4 py-3 text-sm font-medium border rounded-lg transition-colors min-w-[80px] ${
                copiedURL === webhookURL 
                  ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
                  : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border-blue-200 dark:border-blue-800'
              }`}
            >
              {copiedURL === webhookURL ? (
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                  </svg>
                  Copied!
                </div>
              ) : (
                'Copy'
              )}
            </button>
          </div>
        </div>

        {/* Usage Info */}
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white">How to use:</h4>
            {selectedAPIKey && apiKeys && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Using: {apiKeys.find(key => key.id === selectedAPIKey)?.name}
              </span>
            )}
          </div>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>• Send POST requests to this endpoint</li>
            <li>• Replace placeholder with your actual API key value</li>
            <li>• Payload should contain alert information (title, description, severity)</li>
            <li>• Compatible with Prometheus, Grafana, Datadog, and custom systems</li>
          </ul>
        </div>
      </div>

    </div>
  );
}
