'use client';

import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api';
import { toast } from 'react-hot-toast';
import { 
  FlaskIcon, 
  LoadingSpinner, 
  CheckCircleIcon, 
  AlertCircleIcon,
  InfoIcon 
} from '../ui/Icons';
import { Input } from '../ui';

export default function NotificationTestPanel() {
  const { session } = useAuth();
  const [testing, setTesting] = useState(false);
  const [testUserId, setTestUserId] = useState('');
  const [testResults, setTestResults] = useState(null);

  const handleTestNotifications = async () => {
    if (!testUserId.trim()) {
      toast.error('Please enter a user ID to test');
      return;
    }

    setTesting(true);
    setTestResults(null);

    try {
      // Test notification endpoints
      const results = {
        config: null,
        slackTest: null,
        stats: null,
        errors: []
      };

      // 1. Get user notification config
      try {
        results.config = await apiClient.getUserNotificationConfig(testUserId);
        toast.success('✓ User config loaded');
      } catch (error) {
        results.errors.push(`Config Error: ${error.message}`);
        toast.error('✗ Failed to load user config');
      }

      // 2. Test Slack notification
      try {
        await apiClient.testSlackNotification(testUserId);
        results.slackTest = { success: true };
        toast.success('✓ Slack test sent');
      } catch (error) {
        results.slackTest = { success: false, error: error.message };
        results.errors.push(`Slack Error: ${error.message}`);
        toast.error('✗ Slack test failed');
      }

      // 3. Get notification stats
      try {
        results.stats = await apiClient.getUserNotificationStats(testUserId);
        toast.success('✓ Stats loaded');
      } catch (error) {
        results.errors.push(`Stats Error: ${error.message}`);
        toast.error('✗ Failed to load stats');
      }

      setTestResults(results);

      if (results.errors.length === 0) {
        toast.success('🎉 All notification tests passed!');
      } else {
        toast.error(`❌ ${results.errors.length} test(s) failed`);
      }

    } catch (error) {
      console.error('Test failed:', error);
      toast.error('Test suite failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-6">
        <div className="flex items-center space-x-3 mb-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <FlaskIcon className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">
            Notification System Test Panel
          </h3>
        </div>
        <p className="text-sm text-gray-600">
          Test notification functionality for any user in the system.
        </p>
      </div>

      <div className="space-y-4">
        <Input
          label="Test User ID"
          type="text"
          value={testUserId}
          onChange={(e) => setTestUserId(e.target.value)}
          placeholder="Enter user ID to test notifications"
          required
          leftIcon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>}
          helperText="Enter the user ID to test all notification functionality"
        />

        <button
          onClick={handleTestNotifications}
          disabled={testing || !testUserId.trim()}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? (
            <>
              <LoadingSpinner className="w-4 h-4 text-white" />
              <span>Testing...</span>
            </>
          ) : (
            <>
              <FlaskIcon className="w-4 h-4 text-white" />
              <span>Run Full Test Suite</span>
            </>
          )}
        </button>
      </div>

      {testResults && (
        <div className="mt-6 space-y-4">
          <h4 className="font-medium text-gray-900">Test Results</h4>

          {/* User Configuration */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h5 className="font-medium text-gray-700 mb-2">User Configuration</h5>
            {testResults.config ? (
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Slack Enabled:</span>
                  <div className={`flex items-center space-x-1 ${testResults.config.slack_enabled ? 'text-green-600' : 'text-red-600'}`}>
                    {testResults.config.slack_enabled ? (
                      <CheckCircleIcon className="w-3 h-3" />
                    ) : (
                      <AlertCircleIcon className="w-3 h-3" />
                    )}
                    <span>{testResults.config.slack_enabled ? 'Yes' : 'No'}</span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span>Slack User ID:</span>
                  <span className={testResults.config.slack_user_id ? 'text-green-600' : 'text-gray-400'}>
                    {testResults.config.slack_user_id || 'Not configured'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Email Enabled:</span>
                  <div className={`flex items-center space-x-1 ${testResults.config.email_enabled ? 'text-green-600' : 'text-red-600'}`}>
                    {testResults.config.email_enabled ? (
                      <CheckCircleIcon className="w-3 h-3" />
                    ) : (
                      <AlertCircleIcon className="w-3 h-3" />
                    )}
                    <span>{testResults.config.email_enabled ? 'Yes' : 'No'}</span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span>Push Enabled:</span>
                  <div className={`flex items-center space-x-1 ${testResults.config.push_enabled ? 'text-green-600' : 'text-red-600'}`}>
                    {testResults.config.push_enabled ? (
                      <CheckCircleIcon className="w-3 h-3" />
                    ) : (
                      <AlertCircleIcon className="w-3 h-3" />
                    )}
                    <span>{testResults.config.push_enabled ? 'Yes' : 'No'}</span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span>Timezone:</span>
                  <span className="text-gray-600">{testResults.config.timezone}</span>
                </div>
              </div>
            ) : (
              <div className="text-red-600 text-sm">Failed to load configuration</div>
            )}
          </div>

          {/* Slack Test Results */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h5 className="font-medium text-gray-700 mb-2">Slack Test</h5>
            {testResults.slackTest ? (
              <div className={`text-sm ${testResults.slackTest.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResults.slackTest.success ? (
                  <div className="flex items-center space-x-2">
                    <CheckCircleIcon className="w-4 h-4" />
                    <span>Test notification sent successfully</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <AlertCircleIcon className="w-4 h-4" />
                    <span>Failed: {testResults.slackTest.error}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-400 text-sm">No test results</div>
            )}
          </div>

          {/* Notification Statistics */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h5 className="font-medium text-gray-700 mb-2">Notification Statistics</h5>
            {testResults.stats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">
                    {testResults.stats.total_notifications || 0}
                  </div>
                  <div className="text-gray-600">Total</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-purple-600">
                    {testResults.stats.slack_notifications || 0}
                  </div>
                  <div className="text-gray-600">Slack</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-600">
                    {testResults.stats.email_notifications || 0}
                  </div>
                  <div className="text-gray-600">Email</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-500">
                    {testResults.stats.failed_notifications || 0}
                  </div>
                  <div className="text-gray-600">Failed</div>
                </div>
              </div>
            ) : (
              <div className="text-gray-400 text-sm">No statistics available</div>
            )}
          </div>

          {/* Errors */}
          {testResults.errors.length > 0 && (
            <div className="border border-red-200 rounded-lg p-4 bg-red-50">
              <h5 className="font-medium text-red-800 mb-2">Errors</h5>
              <div className="space-y-1">
                {testResults.errors.map((error, index) => (
                  <div key={index} className="text-sm text-red-700">
                    • {error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Help Info */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center space-x-2 mb-2">
          <InfoIcon className="w-5 h-5 text-blue-600" />
          <h5 className="font-medium text-blue-800">Test Guide</h5>
        </div>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Enter any valid user ID from your system</li>
          <li>• Test will check configuration, send Slack notification, and load stats</li>
          <li>• Green checkmarks indicate successful operations</li>
          <li>• Red X marks show failures with detailed error messages</li>
          <li>• User will receive actual test notification if Slack is configured</li>
        </ul>
      </div>
    </div>
  );
}
