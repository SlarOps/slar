'use client';

import { useState, useEffect } from 'react';

const MOCK_ON_CALL_DATA = {
  current_user: {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    team: 'Backend Team',
    phone: '+1234567890'
  },
  is_on_call: true,
  schedule: {
    start_time: '2024-01-15T09:00:00Z',
    end_time: '2024-01-16T09:00:00Z'
  },
  next_user: {
    name: 'Jane Smith',
    start_time: '2024-01-16T09:00:00Z'
  }
};

function formatTimeUntil(timeString) {
  const target = new Date(timeString);
  const now = new Date();
  const diffMs = target - now;
  
  if (diffMs < 0) return 'Ended';
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h remaining`;
  }
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export default function OnCallStatus() {
  const [onCallData, setOnCallData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Simulate API call
    const fetchOnCallData = async () => {
      try {
        // TODO: Replace with actual API call
        // const data = await apiClient.getCurrentOnCallUser();
        setTimeout(() => {
          setOnCallData(MOCK_ON_CALL_DATA);
          setLoading(false);
        }, 800);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchOnCallData();
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">On-Call Status</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">On-Call Status</h3>
        <p className="text-red-600 dark:text-red-400">Error loading on-call data: {error}</p>
      </div>
    );
  }

  const { current_user, is_on_call, schedule, next_user } = onCallData || {};

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">On-Call Status</h3>
      
      {is_on_call ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              You are currently on-call
            </span>
          </div>
          
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <div className="space-y-2">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Duration:</span> {formatTimeUntil(schedule?.end_time)}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Next on-call:</span> {next_user?.name}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              You are not on-call
            </span>
          </div>
          
          {current_user && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="space-y-2">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Current on-call:</span> {current_user.name}
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Team:</span> {current_user.team}
                </p>
                {schedule?.end_time && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium">Until:</span> {formatTimeUntil(schedule.end_time)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
