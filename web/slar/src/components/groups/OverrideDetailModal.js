'use client';

import React from 'react';

export default function OverrideDetailModal({ isOpen, onClose, shift, originalMember, currentMember, onRemoveOverride }) {
  if (!isOpen || !shift) return null;

  const shiftStartDate = new Date(shift.start_time || shift.start);
  const shiftEndDate = new Date(shift.end_time || shift.end);
  const overrideStartDate = shift.override_start_time ? new Date(shift.override_start_time) : null;
  const overrideEndDate = shift.override_end_time ? new Date(shift.override_end_time) : null;

  const hasOverride = shift.is_overridden || shift.override_id;

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600 dark:text-blue-300" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                {hasOverride ? 'Override Details' : 'Shift Details'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {hasOverride ? 'This shift has been overridden' : 'Regular scheduled shift'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Shift Time */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Shift Schedule</h4>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Start</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {shiftStartDate.toLocaleString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: true 
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">End</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {shiftEndDate.toLocaleString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: true 
                  })}
                </span>
              </div>
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Duration: {Math.round((shiftEndDate - shiftStartDate) / (1000 * 60 * 60 * 24))} days
                </span>
              </div>
            </div>
          </div>

          {/* Override Information */}
          {hasOverride ? (
            <>
              {/* Users */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Assignment Change</h4>
                <div className="flex items-center gap-4">
                  {/* Original User */}
                  <div className="flex-1 bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Original</div>
                    {originalMember ? (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                            {originalMember.user_name[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white line-through opacity-60">
                            {originalMember.user_name}
                          </div>
                          {originalMember.user_email && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {originalMember.user_email}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 dark:text-gray-400">Unknown</div>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex-shrink-0">
                    <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>

                  {/* Override User */}
                  <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border-2 border-blue-200 dark:border-blue-800">
                    <div className="text-xs text-blue-600 dark:text-blue-400 mb-2">Override</div>
                    {currentMember ? (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                          <span className="text-sm font-medium text-blue-600 dark:text-blue-300">
                            {currentMember.user_name[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {currentMember.user_name}
                          </div>
                          {currentMember.user_email && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {currentMember.user_email}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 dark:text-gray-400">Unknown</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Override Details */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Override Details</h4>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-3">
                  {shift.override_type && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Type</span>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        shift.override_type === 'permanent' 
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                          : shift.override_type === 'emergency'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                      }`}>
                        {shift.override_type.charAt(0).toUpperCase() + shift.override_type.slice(1)}
                      </span>
                    </div>
                  )}

                  {shift.override_reason && (
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Reason</div>
                      <div className="text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 p-2 rounded">
                        {shift.override_reason}
                      </div>
                    </div>
                  )}

                  {overrideStartDate && overrideEndDate && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Override Start</span>
                        <span className="text-sm text-gray-900 dark:text-white">
                          {overrideStartDate.toLocaleString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            hour: '2-digit', 
                            minute: '2-digit',
                            hour12: true 
                          })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Override End</span>
                        <span className="text-sm text-gray-900 dark:text-white">
                          {overrideEndDate.toLocaleString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            hour: '2-digit', 
                            minute: '2-digit',
                            hour12: true 
                          })}
                        </span>
                      </div>
                    </>
                  )}

                  {shift.created_at && (
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Created: {new Date(shift.created_at).toLocaleString('en-US', { 
                          month: 'short', 
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit', 
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* No Override */
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Assigned To</h4>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                {currentMember ? (
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                      <span className="text-lg font-medium text-blue-600 dark:text-blue-300">
                        {currentMember.user_name[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {currentMember.user_name}
                      </div>
                      {currentMember.user_email && (
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {currentMember.user_email}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No one assigned</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {/* Left side - Remove Override button (only show if override exists) */}
          {hasOverride && onRemoveOverride && (
            <button
              onClick={() => onRemoveOverride(shift)}
              className="px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove Override
            </button>
          )}

          {/* Right side - Close button */}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

