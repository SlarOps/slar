'use client';

import { useState } from 'react';

export default function EscalationLevelEditor({ 
  levels = [], 
  onChange, 
  members = [],
  schedulers = [],  // Add schedulers prop
  maxLevels = 5, 
  defaultTimeout = 5 
}) {
  const addLevel = () => {
    if (levels.length >= maxLevels) return;

    const newLevel = {
      level_number: levels.length + 1,
      target_type: 'user',
      target_id: '',
      timeout_minutes: defaultTimeout,
      notification_methods: ['email'],
      message_template: `Level ${levels.length + 1}: {alert_title} requires attention.`
    };

    onChange([...levels, newLevel]);
  };

  const removeLevel = (index) => {
    if (levels.length <= 1) return; // Keep at least one level

    const updatedLevels = levels
      .filter((_, i) => i !== index)
      .map((level, i) => ({ ...level, level_number: i + 1 }));
    
    onChange(updatedLevels);
  };

  const updateLevel = (index, field, value) => {
    const updatedLevels = levels.map((level, i) => 
      i === index ? { ...level, [field]: value } : level
    );
    onChange(updatedLevels);
  };

  const toggleNotificationMethod = (levelIndex, method) => {
    const level = levels[levelIndex];
    const methods = level.notification_methods.includes(method)
      ? level.notification_methods.filter(m => m !== method)
      : [...level.notification_methods, method];
    
    updateLevel(levelIndex, 'notification_methods', methods);
  };

  const getTargetName = (targetType, targetId) => {
    if (targetType === 'user') {
      const member = members.find(m => m.id === targetId);
      return member?.name || 'Select user';
    }
    if (targetType === 'scheduler') {
      const scheduler = schedulers.find(s => s.id === targetId);
      return scheduler?.name || 'Select scheduler';
    }
    if (targetType === 'current_schedule') {
      return 'Current on-call user';
    }
    if (targetType === 'group') {
      return 'Entire group';
    }
    if (targetType === 'external') {
      return targetId || 'Enter webhook URL';
    }
    return 'Select target';
  };

  const notificationMethods = [
    { value: 'email', label: 'Email', icon: '📧' },
    { value: 'sms', label: 'SMS', icon: '📱' },
    { value: 'push', label: 'Push', icon: '🔔' },
    { value: 'webhook', label: 'Webhook', icon: '🔗' }
  ];

  return (
    <div className="space-y-4">
      {/* Escalation Flow Visualization */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
          Escalation Flow
        </h5>
        <div className="flex items-center space-x-2 overflow-x-auto">
          {levels.map((level, index) => (
            <div key={index} className="flex items-center">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full flex items-center justify-center text-xs font-medium">
                {level.level_number}
              </div>
              {index < levels.length - 1 && (
                <div className="flex-shrink-0 w-6 h-px bg-gray-300 dark:bg-gray-600 mx-2"></div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Escalation Levels */}
      <div className="space-y-4">
        {levels.map((level, index) => (
          <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            {/* Level Header */}
            <div className="flex items-center justify-between mb-4">
              <h5 className="text-sm font-medium text-gray-900 dark:text-white">
                Level {level.level_number}
                {index === 0 && (
                  <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">(First Response)</span>
                )}
                {index === levels.length - 1 && levels.length > 1 && (
                  <span className="ml-2 text-xs text-red-600 dark:text-red-400">(Final Escalation)</span>
                )}
              </h5>
              
              {levels.length > 1 && (
                <button
                  onClick={() => removeLevel(index)}
                  className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Target Type & Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Escalate To
                </label>
                
                {/* Target Type */}
                <div className="space-y-2 mb-3">
                  {[
                    { value: 'current_schedule', label: 'Current On-Call', description: 'Current on-call user from group schedule' },
                    { value: 'scheduler', label: 'Specific Scheduler', description: 'On-call rotation schedule' },
                    { value: 'user', label: 'Specific User', description: 'Direct user assignment' },
                    { value: 'group', label: 'Entire Group', description: 'All group members' },
                    { value: 'external', label: 'External Webhook', description: 'Send to external system' }
                  ].map((type) => (
                    <label key={type.value} className="flex items-start">
                      <input
                        type="radio"
                        name={`target_type_${index}`}
                        value={type.value}
                        checked={level.target_type === type.value}
                        onChange={(e) => updateLevel(index, 'target_type', e.target.value)}
                        className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600"
                      />
                      <div className="ml-2">
                        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                          {type.label}
                        </span>
                        {type.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {type.description}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                {/* Target Selection */}
                {level.target_type === 'user' && (
                  <select
                    value={level.target_id}
                    onChange={(e) => updateLevel(index, 'target_id', e.target.value)}
                    className="w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select team member</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} ({member.email})
                      </option>
                    ))}
                  </select>
                )}

                {level.target_type === 'scheduler' && (
                  <select
                    value={level.target_id}
                    onChange={(e) => updateLevel(index, 'target_id', e.target.value)}
                    className="w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select scheduler</option>
                    {schedulers.map((scheduler) => (
                      <option key={scheduler.id} value={scheduler.id}>
                        {scheduler.name} ({scheduler.rotation_type})
                      </option>
                    ))}
                  </select>
                )}

                {level.target_type === 'current_schedule' && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start">
                      <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="font-medium text-blue-900 dark:text-blue-300">Current on-call user</p>
                        <p className="text-xs mt-1">
                          Will automatically escalate to whoever is currently on-call in this group&apos;s schedule at the time of escalation.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {level.target_type === 'external' && (
                  <input
                    type="url"
                    value={level.target_id}
                    onChange={(e) => updateLevel(index, 'target_id', e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                )}

                {level.target_type === 'group' && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 p-2 bg-gray-100 dark:bg-gray-700 rounded">
                    All active group members will be notified
                  </div>
                )}
              </div>

              {/* Timeout & Notification Methods */}
              <div>
                {/* Timeout */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Timeout (minutes)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={level.timeout_minutes}
                    onChange={(e) => updateLevel(index, 'timeout_minutes', parseInt(e.target.value))}
                    className="w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Time to wait before escalating to next level
                  </p>
                </div>

                {/* Notification Methods */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Notification Methods
                  </label>
                  <div className="space-y-2">
                    {notificationMethods.map((method) => (
                      <label key={method.value} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={level.notification_methods.includes(method.value)}
                          onChange={() => toggleNotificationMethod(index, method.value)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
                        />
                        <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                          {method.icon} {method.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Message Template */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Message Template
              </label>
              <textarea
                value={level.message_template}
                onChange={(e) => updateLevel(index, 'message_template', e.target.value)}
                rows={2}
                className="w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="Custom message for this escalation level..."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Available variables: {'{alert_title}'}, {'{alert_description}'}, {'{severity}'}, {'{service_name}'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Add Level Button */}
      {levels.length < maxLevels && (
        <button
          onClick={addLevel}
          className="w-full flex items-center justify-center px-4 py-3 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add Escalation Level ({levels.length}/{maxLevels})
        </button>
      )}

      {/* Summary */}
      <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4">
        <h5 className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-2">
          Escalation Summary
        </h5>
        <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          {levels.map((level, index) => (
            <div key={index}>
              <strong>Level {level.level_number}:</strong> {getTargetName(level.target_type, level.target_id)} 
              {' '}({level.timeout_minutes}min timeout)
            </div>
          ))}
          <div className="mt-2 text-xs">
            Total escalation time: {levels.reduce((acc, level) => acc + level.timeout_minutes, 0)} minutes
          </div>
        </div>
      </div>
    </div>
  );
}
