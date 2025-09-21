'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api';
import Link from 'next/link';
import { 
  StatusDot, 
  SlackIcon, 
  EmailIcon, 
  SmartphoneIcon, 
  LoadingSpinner,
  CheckCircleIcon,
  AlertCircleIcon,
  ChevronRightIcon 
} from '../ui/Icons';

export default function NotificationStatus() {
  const { session, user } = useAuth();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session?.access_token && user?.id) {
      apiClient.setToken(session.access_token);
      loadNotificationConfig();
    }
  }, [session, user]);

  const loadNotificationConfig = async () => {
    try {
      const response = await apiClient.getUserNotificationConfig(user.id);
      setConfig(response);
    } catch (error) {
      console.error('Failed to load notification config:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center space-x-3">
          <LoadingSpinner className="w-5 h-5 text-blue-600" />
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  // Check if user has configured notifications
  const hasSlackConfig = config?.slack_enabled && config?.slack_user_id;
  const isConfigured = hasSlackConfig || config?.email_enabled;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <StatusDot status={isConfigured ? 'success' : 'warning'} className="w-3 h-3" />
          <div>
            <h3 className="text-lg font-medium text-gray-900">Notification Settings</h3>
            <p className="text-sm text-gray-600">
              {isConfigured 
                ? 'Your notifications are configured and ready!' 
                : 'Complete your notification setup to receive incident alerts'
              }
            </p>
          </div>
        </div>
        
        <Link
          href="/profile?tab=notifications"
          className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 text-sm font-medium"
        >
          <span>Configure</span>
          <ChevronRightIcon className="w-4 h-4" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className={`w-8 h-8 mx-auto mb-2 rounded-lg flex items-center justify-center ${
            config?.slack_enabled && hasSlackConfig 
              ? 'bg-green-100 text-green-600' 
              : 'bg-gray-100 text-gray-400'
          }`}>
            <SlackIcon className="w-4 h-4" />
          </div>
          <div className="text-xs text-gray-600 flex items-center justify-center space-x-1">
            <span>Slack</span>
            {config?.slack_enabled && hasSlackConfig ? (
              <CheckCircleIcon className="w-3 h-3 text-green-500" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-gray-300"></div>
            )}
          </div>
        </div>

        <div className="text-center">
          <div className={`w-8 h-8 mx-auto mb-2 rounded-lg flex items-center justify-center ${
            config?.email_enabled 
              ? 'bg-green-100 text-green-600' 
              : 'bg-gray-100 text-gray-400'
          }`}>
            <EmailIcon className="w-4 h-4" />
          </div>
          <div className="text-xs text-gray-600 flex items-center justify-center space-x-1">
            <span>Email</span>
            {config?.email_enabled ? (
              <CheckCircleIcon className="w-3 h-3 text-green-500" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-gray-300"></div>
            )}
          </div>
        </div>

        <div className="text-center">
          <div className={`w-8 h-8 mx-auto mb-2 rounded-lg flex items-center justify-center ${
            config?.push_enabled 
              ? 'bg-green-100 text-green-600' 
              : 'bg-gray-100 text-gray-400'
          }`}>
            <SmartphoneIcon className="w-4 h-4" />
          </div>
          <div className="text-xs text-gray-600 flex items-center justify-center space-x-1">
            <span>Push</span>
            {config?.push_enabled ? (
              <CheckCircleIcon className="w-3 h-3 text-green-500" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-gray-300"></div>
            )}
          </div>
        </div>
      </div>

      {!isConfigured && (
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-start space-x-2">
            <AlertCircleIcon className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-yellow-700 font-medium">Setup Required</p>
              <p className="text-xs text-yellow-600 mt-1">
                Configure your Slack settings to receive incident notifications.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
