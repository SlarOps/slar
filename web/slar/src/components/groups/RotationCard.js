'use client';

import React, { useState } from 'react';
import { SHIFT_LENGTHS, HANDOFF_DAYS } from './scheduleConstants';
import Select from '../ui/Select';
import Input from '../ui/Input';

export default function RotationCard({ rotation, onUpdate, onDelete, members }) {
  const [isExpanded, setIsExpanded] = useState(true);

  const updateRotation = (field, value) => {
    onUpdate(rotation.id, { ...rotation, [field]: value });
  };

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg mb-4">
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-t-lg">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500 rounded"></div>
            <span className="font-medium text-gray-900 dark:text-white">{rotation.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onDelete(rotation.id)}
            className="text-red-400 hover:text-red-600 p-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Shift Length */}
          <Select
            label="Shift Length"
            value={rotation.shiftLength}
            onChange={(value) => updateRotation('shiftLength', value)}
            options={SHIFT_LENGTHS}
            required
          />

          {/* Handoff Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Handoff Day & Time
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Select
                  value={rotation.handoffDay}
                  onChange={(value) => updateRotation('handoffDay', value)}
                  options={HANDOFF_DAYS}
                />
              </div>
              <div className="w-32">
                <Input
                  type="time"
                  value={rotation.handoffTime}
                  onChange={(e) => updateRotation('handoffTime', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Starts */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Starts <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="date"
                  value={rotation.startDate}
                  onChange={(e) => updateRotation('startDate', e.target.value)}
                />
              </div>
              <div className="w-32">
                <Input
                  type="time"
                  value={rotation.startTime}
                  onChange={(e) => updateRotation('startTime', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Ends - Optional */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Ends <span className="text-gray-400 text-xs">optional</span>
              </label>
              <label className="inline-flex items-center">
                <input
                  type="checkbox"
                  checked={rotation.hasEndDate}
                  onChange={(e) => updateRotation('hasEndDate', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
            </div>
            {rotation.hasEndDate && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    type="date"
                    value={rotation.endDate}
                    onChange={(e) => updateRotation('endDate', e.target.value)}
                  />
                </div>
                <div className="w-32">
                  <Input
                    type="time"
                    value={rotation.endTime}
                    onChange={(e) => updateRotation('endTime', e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
