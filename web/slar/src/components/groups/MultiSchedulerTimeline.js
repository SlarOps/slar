'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import ScheduleTimeline from './ScheduleTimeline';
import ConfirmationModal from './ConfirmationModal';
import toast from 'react-hot-toast';

export default function MultiSchedulerTimeline({ groupId, members }) {
  const { session } = useAuth();
  const [schedulers, setSchedulers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('');

  // Confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'Confirm',
    isLoading: false
  });

  useEffect(() => {
    fetchSchedulerTimelines();
  }, [groupId, session]);

  // Helper function to show confirmation modal
  const showConfirmation = (title, message, onConfirm, confirmText = 'Confirm') => {
    setConfirmationModal({
      isOpen: true,
      title,
      message,
      onConfirm,
      confirmText,
      isLoading: false
    });
  };

  const closeConfirmation = () => {
    setConfirmationModal({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: null,
      confirmText: 'Confirm',
      isLoading: false
    });
  };

  const handleDeleteScheduler = (schedulerId, schedulerName) => {
    showConfirmation(
      'Delete Scheduler',
      `Are you sure you want to delete the scheduler "${schedulerName}"? This will also delete all associated shifts. This action cannot be undone.`,
      async () => {
        setConfirmationModal(prev => ({ ...prev, isLoading: true }));

        if (!session?.access_token) {
          toast.error('Not authenticated');
          closeConfirmation();
          return;
        }

        try {
          apiClient.setToken(session.access_token);
          await apiClient.deleteScheduler(groupId, schedulerId);

          // Remove scheduler from state
          setSchedulers(prev => prev.filter(s => s.id !== schedulerId));
          // Remove associated shifts from state
          setShifts(prev => prev.filter(s => s.scheduler_id !== schedulerId));

          // If the deleted scheduler was the active tab, switch to the first available scheduler
          if (activeTab === schedulerId) {
            const remainingSchedulers = schedulers.filter(s => s.id !== schedulerId);
            setActiveTab(remainingSchedulers.length > 0 ? remainingSchedulers[0].id : '');
          }

          toast.success('Scheduler deleted successfully');
          closeConfirmation();
        } catch (error) {
          console.error('Failed to delete scheduler:', error);
          toast.error('Failed to delete scheduler: ' + error.message);
          closeConfirmation();
        }
      },
      'Yes, Delete'
    );
  };

  const fetchSchedulerTimelines = async () => {
    if (!session?.access_token || !groupId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);
      
      // Fetch schedulers and shifts for the group
      const [schedulersResponse, shiftsResponse] = await Promise.all([
        apiClient.getGroupSchedulers(groupId),
        apiClient.getGroupShifts(groupId)
      ]);
      
      setSchedulers(schedulersResponse.schedulers || []);
      setShifts(shiftsResponse.shifts || []);
      
      // Set default active tab to first scheduler
      if (schedulersResponse.schedulers && schedulersResponse.schedulers.length > 0) {
        setActiveTab(schedulersResponse.schedulers[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch schedulers and shifts:', error);
      setSchedulers([]);
      setShifts([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  // Group shifts by scheduler for timeline view
  const schedulerTimelines = schedulers.map(scheduler => {
    const schedulerShifts = shifts.filter(shift => shift.scheduler_id === scheduler.id);
    return {
      id: scheduler.id,
      name: scheduler.name,
      displayName: scheduler.display_name,
      type: 'scheduler',
      schedule_count: schedulerShifts.length,
      schedules: schedulerShifts
    };
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Header with Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between p-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Schedule Timelines
          </h3>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {schedulers.length} scheduler{schedulers.length !== 1 ? 's' : ''} • {shifts.length} shift{shifts.length !== 1 ? 's' : ''}
          </div>
        </div>
        
        {/* Tabs */}
        <div className="px-6">
          <nav className="flex space-x-8" aria-label="Tabs">
            {/* Individual Scheduler Tabs */}
            {schedulerTimelines.map((timeline) => (
              <button
                key={timeline.id}
                onClick={() => setActiveTab(timeline.id)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === timeline.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {timeline.displayName}
                <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs">
                  {timeline.schedule_count}
                </span>
                <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  Scheduler
                </span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="p-6">
        {(() => {
          const currentTimeline = schedulerTimelines.find(t => t.id === activeTab);
          
          if (!currentTimeline) {
            return (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 002 2z" />
                </svg>
                <p>No schedulers found.</p>
              </div>
            );
          }

          return (
            <div>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-md font-medium text-gray-900 dark:text-white">
                    {currentTimeline.name}
                  </h4>

                  {/* Delete Scheduler Button */}
                  <button
                    onClick={() => handleDeleteScheduler(currentTimeline.id, currentTimeline.name)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title={`Delete scheduler "${currentTimeline.name}"`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Scheduler
                  </button>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>Type: Scheduler</span>
                  <span>•</span>
                  <span>{currentTimeline.schedule_count} shift{currentTimeline.schedule_count !== 1 ? 's' : ''}</span>
                </div>
              </div>
              
              {currentTimeline.schedules.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 002 2z" />
                  </svg>
                  <p>No shifts found for this scheduler.</p>
                </div>
              ) : (
                <ScheduleTimeline
                  rotations={currentTimeline.schedules}
                  members={members}
                  selectedMembers={(() => {
                    // Get unique members from current scheduler shifts
                    const uniqueMembers = [];
                    const seenIds = new Set();
                    
                    currentTimeline.schedules.forEach(shift => {
                      if (shift.user_id && !seenIds.has(shift.user_id)) {
                        seenIds.add(shift.user_id);
                        const memberDetails = members.find(m => m.user_id === shift.user_id);
                        if (memberDetails) {
                          uniqueMembers.push(memberDetails);
                        } else {
                          uniqueMembers.push({
                            user_id: shift.user_id,
                            user_name: shift.user_name || 'Unknown User',
                            user_email: shift.user_email || '',
                            user_team: shift.user_team || ''
                          });
                        }
                      }
                    });
                    
                    return uniqueMembers;
                  })()}
                  viewMode="week"
                  isVisible={true}
                />
              )}
            </div>
          );
        })()}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmationModal.isOpen}
        onClose={closeConfirmation}
        onConfirm={confirmationModal.onConfirm}
        title={confirmationModal.title}
        message={confirmationModal.message}
        confirmText={confirmationModal.confirmText}
        cancelText="Cancel"
        isLoading={confirmationModal.isLoading}
      />
    </div>
  );
}