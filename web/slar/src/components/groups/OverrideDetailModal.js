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
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
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
        <div className="p-6 space-y-8">

          {/* Layer 1: Original Schedule */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-8 bg-gray-400 rounded-sm"></div>
              <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Original Schedule</h4>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {originalMember ? (
                    <>
                      <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                          {originalMember.user_name[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {originalMember.user_name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Original Assignee
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400">Unknown Original User</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {shiftStartDate.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} - {shiftEndDate.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {shiftStartDate.toLocaleDateString()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Layer 2: Override */}
          {hasOverride && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-8 bg-blue-500 rounded-sm"></div>
                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Override</h4>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border-2 border-dashed border-blue-300 dark:border-blue-700 relative overflow-hidden">
                {/* Background pattern */}
                <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #3b82f6 0, #3b82f6 10px, transparent 10px, transparent 20px)' }}></div>

                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {currentMember ? (
                        <>
                          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center border-2 border-white dark:border-gray-600 shadow-sm">
                            <span className="text-sm font-medium text-blue-600 dark:text-blue-200">
                              {currentMember.user_name[0].toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">
                              {currentMember.user_name}
                            </div>
                            <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                              Override Assignee
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400">Unknown Override User</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        {overrideStartDate ? overrideStartDate.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'Full Shift'}
                        {overrideEndDate ? ` - ${overrideEndDate.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}` : ''}
                      </div>
                      {shift.override_reason && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded inline-block">
                          Reason: {shift.override_reason}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Override Type Badge */}
                  {shift.override_type && (
                    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100">
                      {shift.override_type.charAt(0).toUpperCase() + shift.override_type.slice(1)} Override
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Layer 3: Final Schedule */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-8 bg-green-500 rounded-sm"></div>
              <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Final Schedule</h4>
            </div>

            <div className="space-y-2">
              {(() => {
                // Logic to split segments (same as timeline)
                const segments = [];

                if (hasOverride && overrideStartDate && overrideEndDate) {
                  // 1. Pre-override
                  if (shiftStartDate < overrideStartDate && originalMember) {
                    segments.push({
                      type: 'original',
                      start: shiftStartDate,
                      end: overrideStartDate,
                      member: originalMember
                    });
                  }
                  // 2. Override
                  segments.push({
                    type: 'override',
                    start: overrideStartDate,
                    end: overrideEndDate,
                    member: currentMember
                  });
                  // 3. Post-override
                  if (overrideEndDate < shiftEndDate && originalMember) {
                    segments.push({
                      type: 'original',
                      start: overrideEndDate,
                      end: shiftEndDate,
                      member: originalMember
                    });
                  }
                } else {
                  // Full shift (either fully overridden or no override)
                  segments.push({
                    type: hasOverride ? 'override' : 'original',
                    start: shiftStartDate,
                    end: shiftEndDate,
                    member: currentMember || originalMember
                  });
                }

                return segments.map((segment, idx) => (
                  <div key={idx} className={`flex items-center p-3 rounded-lg border ${segment.type === 'override'
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                      : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 opacity-75'
                    }`}>
                    <div className="w-24 text-xs text-gray-500 dark:text-gray-400 font-mono shrink-0">
                      {segment.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                      <br />
                      ↓
                      <br />
                      {segment.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>

                    <div className="w-px h-10 bg-gray-300 dark:bg-gray-600 mx-3"></div>

                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${segment.type === 'override'
                          ? 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-100'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                        {segment.member ? segment.member.user_name[0].toUpperCase() : '?'}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {segment.member ? segment.member.user_name : 'Unknown'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {segment.type === 'override' ? 'Effective On-Call' : 'Original On-Call'}
                        </div>
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

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

