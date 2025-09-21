'use client';

import React, { useState, useEffect } from 'react';
// Import extracted components
import RotationCard from './RotationCard';
import MembersList from './MembersList';
import SchedulePreview from './SchedulePreview';
import { TIME_ZONES, DEFAULT_ROTATION } from './scheduleConstants';

export default function EnhancedCreateScheduleModal({ isOpen, onClose, members, groupId, session, onSubmit, existingSchedules = [] }) {
  const [formData, setFormData] = useState({
    name: '',
    timeZone: 'UTC',
    team: '',
    rotations: [],
    conditions: [],
    selectedMembers: []
  });

  // Initialize with default rotation
  useEffect(() => {
    if (isOpen && formData.rotations.length === 0) {
      const today = new Date();
      setFormData(prev => ({
        ...prev,
        name: `Datajet - New Schedule - ${today.toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })} am`,
        rotations: [{
          ...DEFAULT_ROTATION,
          id: 1,
          startDate: today.toISOString().split('T')[0],
          startTime: '00:04'
        }]
      }));
    }
  }, [isOpen, formData.rotations.length]);

  const addRotation = () => {
    const newRotation = {
      ...DEFAULT_ROTATION,
      id: Date.now(),
      name: `Rotation ${formData.rotations.length + 1}`,
      startDate: new Date().toISOString().split('T')[0]
    };
    
    setFormData(prev => ({
      ...prev,
      rotations: [...prev.rotations, newRotation]
    }));
  };

  const updateRotation = (id, updatedRotation) => {
    setFormData(prev => ({
      ...prev,
      rotations: prev.rotations.map(rotation => 
        rotation.id === id ? updatedRotation : rotation
      )
    }));
  };

  const deleteRotation = (id) => {
    setFormData(prev => ({
      ...prev,
      rotations: prev.rotations.filter(rotation => rotation.id !== id)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Convert to API format with scheduler information
    const scheduleData = {
      name: formData.name,
      time_zone: formData.timeZone,
      rotations: formData.rotations,
      members: formData.selectedMembers,
      // NEW: Scheduler information
      schedulerName: formData.team || formData.name || 'default',
      schedulerDisplayName: formData.team ? `${formData.team} Team` : `${formData.name} Team`,
      description: `Scheduler for ${formData.team || formData.name}`,
      rotationType: 'manual' // Default rotation type
    };
    
    onSubmit(scheduleData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-7xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
            New schedule
          </h3>
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
        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel - Configuration */}
          <div className="w-1/3 p-4 overflow-y-auto border-r border-gray-200 dark:border-gray-700">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>

              {/* Schedule Time Zone */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Schedule Time Zone <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.timeZone}
                  onChange={(e) => setFormData(prev => ({ ...prev, timeZone: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {TIME_ZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>

              {/* Teams */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Teams
                </label>
                <select
                  value={formData.team}
                  onChange={(e) => setFormData(prev => ({ ...prev, team: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Datajet</option>
                </select>
              </div>

              {/* Schedule Rotations */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Schedule Rotations
                  </label>
                  <button
                    type="button"
                    onClick={addRotation}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add
                  </button>
                </div>
                
                <div className="space-y-4">
                  {formData.rotations.map(rotation => (
                    <RotationCard
                      key={rotation.id}
                      rotation={rotation}
                      onUpdate={updateRotation}
                      onDelete={deleteRotation}
                      members={members}
                    />
                  ))}
                </div>
              </div>

              {/* Conditions */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Conditions
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add
                  </button>
                </div>
              </div>

              {/* Members */}
              <MembersList
                members={members}
                selectedMembers={formData.selectedMembers}
                onMembersChange={(members) => setFormData(prev => ({ ...prev, selectedMembers: members }))}
              />
            </form>
          </div>

          {/* Right Panel - Preview */}
          <div className="w-2/3 p-6 overflow-y-auto bg-gray-50 dark:bg-gray-900">
            <SchedulePreview
              rotations={formData.rotations}
              members={members}
              selectedMembers={formData.selectedMembers}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!formData.name || !formData.selectedMembers.length}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Schedule
          </button>
        </div>
      </div>
    </div>
  );
}