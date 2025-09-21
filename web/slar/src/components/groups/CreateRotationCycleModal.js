import React, { useState, useEffect } from 'react';
import apiClient from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const ROTATION_TYPES = [
  {
    value: 'daily',
    label: 'Daily Rotation',
    description: 'Members rotate every day',
    emoji: '📅',
    days: 1,
    color: 'bg-blue-50 border-blue-200 text-blue-900'
  },
  {
    value: 'weekly',
    label: 'Weekly Rotation',
    description: 'Members rotate every week',
    emoji: '📅',
    days: 7,
    color: 'bg-green-50 border-green-200 text-green-900'
  },
  {
    value: 'custom',
    label: 'Custom Rotation',
    description: 'Set your own rotation period',
    emoji: '⏰',
    days: 7,
    color: 'bg-purple-50 border-purple-200 text-purple-900'
  }
];

const TIME_PRESETS = [
  { label: '24/7 Coverage', startTime: '00:00', endTime: '23:59' },
  { label: 'Business Hours', startTime: '09:00', endTime: '17:00' },
  { label: 'Extended Hours', startTime: '08:00', endTime: '20:00' },
  { label: 'Night Shift', startTime: '22:00', endTime: '06:00' }
];

function CreateRotationCycleModal({ isOpen, onClose, groupId, groupMembers, onRotationCreated }) {
  const { session } = useAuth();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState([]);

  const [formData, setFormData] = useState({
    rotation_type: 'weekly',
    rotation_days: 7,
    start_date: new Date().toISOString().split('T')[0], // Today
    start_time: '00:00',
    end_time: '23:59',
    member_order: [],
    weeks_ahead: 52 // Generate 1 year
  });

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const today = new Date();
      setFormData({
        rotation_type: 'weekly',
        rotation_days: 7,
        start_date: today.toISOString().split('T')[0],
        start_time: '00:00',
        end_time: '23:59',
        member_order: [],
        weeks_ahead: 52
      });
      setStep(1);
      setError('');
      setPreview([]);
    }
  }, [isOpen]);

  // Generate preview when form changes
  useEffect(() => {
    if (formData.member_order.length >= 2 && formData.start_date) {
      generatePreview();
    }
  }, [formData]);

  const generatePreview = () => {
    const startDate = new Date(formData.start_date);
    const preview = [];
    
    // Check if this is a cross-day shift (end_time < start_time, e.g., 16:00 - 15:59)  
    const isCrossDayShift = formData.end_time < formData.start_time;
    
    for (let week = 0; week < 4; week++) {
      let weekStart, weekEnd;
      
      if (isCrossDayShift) {
        // For cross-day shifts: continuous coverage with no gaps
        // Week 1: Aug 23 → Aug 29, Week 2: Aug 29 → Sep 4, etc.
        weekStart = new Date(startDate);
        weekStart.setDate(startDate.getDate() + (week * (formData.rotation_days - 1)));
        
        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + formData.rotation_days - 1);
      } else {
        // For same-day shifts: standard gap-free rotation
        weekStart = new Date(startDate);
        weekStart.setDate(startDate.getDate() + (week * formData.rotation_days));
        
        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + formData.rotation_days - 1);
      }
      
      const memberIndex = week % formData.member_order.length;
      const memberId = formData.member_order[memberIndex];
      const member = groupMembers.find(m => m.user_id === memberId);
      
      preview.push({
        week: week + 1,
        startDate: weekStart,
        endDate: weekEnd,
        member: member || { user_name: 'Unknown', user_email: '' },
        memberId
      });
    }
    
    setPreview(preview);
  };

  const handleRotationTypeChange = (type) => {
    const rotationType = ROTATION_TYPES.find(rt => rt.value === type);
    setFormData(prev => ({
      ...prev,
      rotation_type: type,
      rotation_days: rotationType.days
    }));
  };

  const handleTimePreset = (preset) => {
    setFormData(prev => ({
      ...prev,
      start_time: preset.startTime,
      end_time: preset.endTime
    }));
  };

  const handleMemberToggle = (memberId) => {
    setFormData(prev => {
      const isSelected = prev.member_order.includes(memberId);
      if (isSelected) {
        return {
          ...prev,
          member_order: prev.member_order.filter(id => id !== memberId)
        };
      } else {
        return {
          ...prev,
          member_order: [...prev.member_order, memberId]
        };
      }
    });
  };

  const moveMemberUp = (index) => {
    if (index === 0) return;
    setFormData(prev => {
      const newOrder = [...prev.member_order];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      return { ...prev, member_order: newOrder };
    });
  };

  const moveMemberDown = (index) => {
    if (index === formData.member_order.length - 1) return;
    setFormData(prev => {
      const newOrder = [...prev.member_order];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      return { ...prev, member_order: newOrder };
    });
  };

  const handleSubmit = async () => {
    if (!session?.access_token) {
      setError('Not authenticated');
      return;
    }

    if (formData.member_order.length < 2) {
      setError('Please select at least 2 members for rotation');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      apiClient.setToken(session.access_token);
      const response = await apiClient.createRotationCycle(groupId, formData);
      onRotationCreated?.(response);
      onClose();
    } catch (error) {
      console.error('Failed to create rotation cycle:', error);
      
      // Check if it's a migration-related error
      if (error.message && error.message.includes('migration')) {
        setError('🚧 Rotation cycles feature is not available yet. Please ask your administrator to apply database migrations.');
      } else if (error.message && error.message.includes('400')) {
        setError('🚧 Database migrations required. Please run "./mg.sh" in the api directory to enable rotation cycles.');
      } else {
        setError('Failed to create rotation cycle. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const canProceedToStep2 = formData.member_order.length >= 2;
  const canProceedToStep3 = formData.start_date && formData.start_time && formData.end_time;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Create Automatic Rotation</h3>
              <p className="text-sm text-gray-600 mt-1">Set up recurring on-call rotations for your team</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl font-bold"
            >
              ×
            </button>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center mt-4 space-x-4">
            <div className={`flex items-center space-x-2 ${step >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}>
                1
              </div>
              <span className="text-sm font-medium">Members</span>
            </div>
            <div className="flex-1 h-px bg-gray-200" />
            <div className={`flex items-center space-x-2 ${step >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}>
                2
              </div>
              <span className="text-sm font-medium">Schedule</span>
            </div>
            <div className="flex-1 h-px bg-gray-200" />
            <div className={`flex items-center space-x-2 ${step >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}>
                3
              </div>
              <span className="text-sm font-medium">Preview</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <span className="text-red-600 text-lg mt-0.5">⚠️</span>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Step 1: Select Members and Rotation Order */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-3">
                  🔄 Select Members for Rotation
                </h4>
                <p className="text-sm text-gray-600 mb-4">
                  Choose team members and set their rotation order. Drag to reorder.
                </p>

                <div className="space-y-3">
                  {groupMembers.map((member) => {
                    const isSelected = formData.member_order.includes(member.user_id);
                    const orderIndex = formData.member_order.indexOf(member.user_id);
                    
                    return (
                      <div key={member.user_id} className="flex items-center space-x-3">
                        <button
                          onClick={() => handleMemberToggle(member.user_id)}
                          className={`flex-1 p-3 rounded-lg border-2 text-left transition-all ${
                            isSelected 
                              ? 'border-blue-500 bg-blue-50' 
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                              isSelected ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-700'
                            }`}>
                              {isSelected ? (orderIndex + 1) : member.user_name?.charAt(0) || '?'}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{member.user_name || 'Unknown'}</p>
                              <p className="text-sm text-gray-600">{member.user_email}</p>
                              <p className="text-xs text-gray-500">{member.role} • {member.notification_type}</p>
                            </div>
                          </div>
                        </button>

                        {isSelected && (
                          <div className="flex space-x-1">
                            <button
                              onClick={() => moveMemberUp(orderIndex)}
                              disabled={orderIndex === 0}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                              title="Move up"
                            >
                              <span className="text-sm">↑</span>
                            </button>
                            <button
                              onClick={() => moveMemberDown(orderIndex)}
                              disabled={orderIndex === formData.member_order.length - 1}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                              title="Move down"
                            >
                              <span className="text-sm">↓</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {formData.member_order.length < 2 && (
                  <p className="text-sm text-amber-600 mt-3">
                    ⚠️ Please select at least 2 members for rotation
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Schedule Configuration */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-3">
                  📅 Configure Rotation Schedule
                </h4>

                {/* Rotation Type */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Rotation Type
                  </label>
                  <div className="grid grid-cols-1 gap-3">
                    {ROTATION_TYPES.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => handleRotationTypeChange(type.value)}
                        className={`p-4 rounded-lg border-2 text-left transition-all ${
                          formData.rotation_type === type.value
                            ? 'border-blue-500 ' + type.color
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-xl">{type.emoji}</span>
                          <div>
                            <p className="font-medium">{type.label}</p>
                            <p className="text-sm opacity-70">{type.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom rotation days */}
                {formData.rotation_type === 'custom' && (
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Rotation Period (Days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={formData.rotation_days}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        rotation_days: parseInt(e.target.value) || 1 
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Start Date */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Time Presets */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Coverage Hours (Quick Presets)
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {TIME_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => handleTimePreset(preset)}
                        className="p-2 text-sm border border-gray-300 rounded hover:bg-gray-50 text-left"
                      >
                        <div className="font-medium">{preset.label}</div>
                        <div className="text-gray-600">{preset.startTime} - {preset.endTime}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Time Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={formData.start_time}
                      onChange={(e) => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={formData.end_time}
                      onChange={(e) => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-3">
                  👀 Rotation Preview
                </h4>
                <p className="text-sm text-gray-600 mb-4">
                  Review the rotation schedule for the next 4 periods. The system will automatically generate {formData.weeks_ahead} weeks of schedules.
                </p>

                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="space-y-3">
                    {preview.map((week) => (
                      <div key={week.week} className="flex items-center justify-between p-3 bg-white rounded border">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                            {week.week}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{week.member.user_name}</p>
                            <p className="text-sm text-gray-600">{week.member.user_email}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-900">
                            {week.startDate.toLocaleDateString()} - {week.endDate.toLocaleDateString()}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formData.start_time} - {formData.end_time}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <span className="text-blue-600 text-lg mt-0.5">✅</span>
                    <div>
                      <p className="text-blue-900 font-medium">Automatic Schedule Generation</p>
                      <p className="text-blue-700 text-sm">
                        This will create <strong>{formData.weeks_ahead} weeks</strong> of schedules automatically. 
                        Members will rotate every <strong>{formData.rotation_days} day(s)</strong> starting from{' '}
                        <strong>{formData.start_date}</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="flex space-x-3">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Back
              </button>
            )}
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={(step === 1 && !canProceedToStep2) || (step === 2 && !canProceedToStep3)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creating...' : 'Create Rotation'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateRotationCycleModal;
