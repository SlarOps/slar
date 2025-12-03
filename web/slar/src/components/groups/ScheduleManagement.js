'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';
import { createScheduleWorkflow, createSchedulerWorkflow, updateSchedulerWorkflow } from '../../services/scheduleService';
import { createOptimizedSchedulerWorkflow } from '../../services/optimizedScheduleService';
import EnhancedCreateScheduleModal from './EnhancedCreateScheduleModal';
import OptimizedCreateScheduleModal from './OptimizedCreateScheduleModal';
import MultiSchedulerTimeline from './MultiSchedulerTimeline';

import CreateOverrideModal from './CreateOverrideModal';
import ShiftSwapModal from './ShiftSwapModal';
import ConfirmationModal from './ConfirmationModal';
import toast, { Toaster } from 'react-hot-toast';

const DAYS_OF_WEEK = [
  { value: 'monday', label: 'Monday', short: 'Mon' },
  { value: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { value: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { value: 'thursday', label: 'Thursday', short: 'Thu' },
  { value: 'friday', label: 'Friday', short: 'Fri' },
  { value: 'saturday', label: 'Saturday', short: 'Sat' },
  { value: 'sunday', label: 'Sunday', short: 'Sun' }
];





function formatScheduleTime(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  // Format times in UTC to match database values
  const startDate = start.toISOString().split('T')[0]; // YYYY-MM-DD
  const startTime24 = start.toISOString().split('T')[1].slice(0, 5); // HH:MM
  const endDate = end.toISOString().split('T')[0];
  const endTime24 = end.toISOString().split('T')[1].slice(0, 5);
  
  if (startDate === endDate) {
    return `${startDate} ${startTime24} - ${endTime24} UTC`;
  }
  return `${startDate} ${startTime24} UTC - ${endDate} ${endTime24} UTC`;
}





export default function ScheduleManagement({ groupId, members }) {
  const { session } = useAuth();
  const { currentOrg, currentProject } = useOrg();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [showCreateOverride, setShowCreateOverride] = useState(false);
  const [showShiftSwap, setShowShiftSwap] = useState(false);
  const [selectedScheduleForOverride, setSelectedScheduleForOverride] = useState(null);
  const [selectedScheduleForSwap, setSelectedScheduleForSwap] = useState(null);
  
  // NEW: Edit scheduler state
  const [editingScheduler, setEditingScheduler] = useState(null);
  const [showEditSchedule, setShowEditSchedule] = useState(false);

  
  // Confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'Confirm',
    isLoading: false
  });

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

  // Helper function to fetch schedules and rotations
  const fetchSchedules = async () => {
    // ReBAC: MUST have session AND org_id for tenant isolation
    if (!session?.access_token || !groupId || !currentOrg?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Set authentication token
      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };

      // Fetch group shifts (all shifts with scheduler context)
      const shiftsData = await apiClient.getGroupShifts(groupId, rebacFilters);
      console.log('🔍 Shifts data:', shiftsData);
      setSchedules(shiftsData.shifts || []);
    } catch (error) {
      console.error('Failed to fetch schedules:', error);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, [groupId, session, currentOrg?.id, currentProject?.id]);

  const currentOnCall = schedules.find(schedule => {
    const now = new Date();
    const start = new Date(schedule.start_time);
    const end = new Date(schedule.end_time);
    return now >= start && now <= end && schedule.is_active;
  });



  const handleCreateSchedule = () => {
    setEditingScheduler(null); // Clear any editing state
    setShowCreateSchedule(true);
  };

  // NEW: Handle edit scheduler (with progressive loading)
  const handleEditScheduler = async (schedulerId) => {
    if (!session?.access_token || !currentOrg?.id) {
      toast.error('Not authenticated');
      return;
    }

    // OPTIMIZATION: Show modal immediately with loading state
    setEditingScheduler({ id: schedulerId, loading: true });
    setShowEditSchedule(true);

    try {
      // Fetch scheduler with shifts in background
      apiClient.setToken(session.access_token);
      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };
      const schedulerData = await apiClient.getSchedulerWithShifts(groupId, schedulerId, rebacFilters);

      console.log('📝 Fetched scheduler for editing:', schedulerData);

      // Update with actual data
      setEditingScheduler({ ...schedulerData.scheduler, loading: false });
    } catch (error) {
      console.error('Failed to fetch scheduler:', error);
      toast.error('Failed to load scheduler data');

      // Close modal on error
      setShowEditSchedule(false);
      setEditingScheduler(null);
    }
  };



  const handleDeleteSchedule = (scheduleId) => {
    showConfirmation(
      'Delete Schedule',
      'Are you sure you want to delete this schedule? This action cannot be undone.',
      async () => {
        setConfirmationModal(prev => ({ ...prev, isLoading: true }));

        if (!session?.access_token || !currentOrg?.id) {
          toast.error('Not authenticated');
          closeConfirmation();
          return;
        }

        try {
          apiClient.setToken(session.access_token);
          // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
          const rebacFilters = {
            org_id: currentOrg.id,
            ...(currentProject?.id && { project_id: currentProject.id })
          };
          await apiClient.deleteSchedule(scheduleId, rebacFilters);

          // Optimistically update UI
          setSchedules(prev => prev.filter(s => s.id !== scheduleId));
          toast.success('Schedule deleted successfully');
          closeConfirmation();
        } catch (error) {
          console.error('Failed to delete schedule:', error);
          toast.error('Failed to delete schedule: ' + error.message);
          closeConfirmation();
        }
      },
      'Yes, Delete'
    );
  };

  const handleCreateOverride = (schedule) => {
    setSelectedScheduleForOverride(schedule);
    setShowCreateOverride(true);
  };

  const handleSwapShift = (schedule) => {
    setSelectedScheduleForSwap(schedule);
    setShowShiftSwap(true);
  };

  const handleShiftSwapRequested = async (swapRequest) => {
    if (!session?.access_token || !currentOrg?.id) {
      throw new Error('Not authenticated');
    }

    try {
      // Use the new shift swap API endpoint
      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };

      const response = await apiClient.swapSchedules(groupId, swapRequest, rebacFilters);

      if (response.success) {
        // Refresh schedules to show the swap
        const schedulesData = await apiClient.getGroupSchedules(groupId, rebacFilters);
        setSchedules(schedulesData.schedules || []);

        toast.success('Shifts swapped successfully!');
      } else {
        throw new Error(response.message || 'Swap failed');
      }

    } catch (error) {
      console.error('Failed to swap shifts:', error);
      throw error;
    }
  };

  const handleOverrideCreated = async (overrideRequest) => {
    if (!session?.access_token || !currentOrg?.id) {
      throw new Error('Not authenticated');
    }

    try {
      // Set authentication token
      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };

      console.log('🔍 Override Request Data:', overrideRequest);

      // Create override using API client
      const result = await apiClient.createOverride(groupId, overrideRequest, rebacFilters);
      console.log('✅ Override created:', result);

      // Refresh schedules to show the override
      await fetchSchedules();
      toast.success('Override created successfully!');
    } catch (error) {
      console.error('❌ Failed to create override:', error);
      throw error;
    }
  };

  const handleRemoveOverride = (overrideId) => {
    showConfirmation(
      'Remove Override',
      'Are you sure you want to remove this override? The original assignment will be restored.',
      async () => {
        setConfirmationModal(prev => ({ ...prev, isLoading: true }));

        if (!session?.access_token || !currentOrg?.id) {
          toast.error('Not authenticated');
          closeConfirmation();
          return;
        }

        try {
          // Set authentication token
          apiClient.setToken(session.access_token);

          // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
          const rebacFilters = {
            org_id: currentOrg.id,
            ...(currentProject?.id && { project_id: currentProject.id })
          };

          // Delete override using API client
          await apiClient.deleteOverride(groupId, overrideId, rebacFilters);
          console.log('✅ Override removed:', overrideId);

          // Refresh schedules to show the change
          await fetchSchedules();
          toast.success('Override removed successfully!');
          closeConfirmation();
        } catch (error) {
          console.error('❌ Failed to remove override:', error);
          toast.error('Failed to remove override: ' + error.message);
          closeConfirmation();
        }
      },
      'Yes, Remove'
    );
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg dark:border-gray-700 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            On-Call Schedule
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Manage rotation schedules for group members
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateSchedule}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Schedule
          </button>
        </div>
      </div>

      {/* Schedule Timeline */}
        
        {schedules.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="mb-2">No schedules created yet.</p>
            <button
              onClick={handleCreateSchedule}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Create your first schedule
            </button>
          </div>
        ) : (
          <MultiSchedulerTimeline
            groupId={groupId}
            members={members}
            onEditScheduler={handleEditScheduler}
          />
        )}

      {/* Optimized Create Schedule Modal */}
      {showCreateSchedule && (
        <OptimizedCreateScheduleModal
          isOpen={showCreateSchedule}
          onClose={() => setShowCreateSchedule(false)}
          members={members}
          groupId={groupId}
          session={session}
          existingSchedules={schedules}
          mode="create"
          onSubmit={async (scheduleData) => {
            try {
              // Use new scheduler workflow (with automatic fallback to legacy)
              const result = await createOptimizedSchedulerWorkflow({
                apiClient,
                session,
                groupId,
                scheduleData,
                onProgress: (message) => {
                  // Progress is handled by the modal itself
                  console.log('Progress:', message);
                },
                onSuccess: (scheduler, shifts, performance) => {
                  // Add all new shifts to the schedule list (for backward compatibility)
                  setSchedules(prev => [...shifts, ...prev]);
                  setShowCreateSchedule(false);

                  // Show success with performance info
                  const duration = performance?.total_frontend_duration_ms || 0;
                  toast.success(
                    `Scheduler "${scheduler.display_name}" created with ${shifts.length} shift(s) in ${duration.toFixed(0)}ms!`,
                    { duration: 4000 }
                  );
                },
                onError: (error, performance) => {
                  const duration = performance?.duration_ms || 0;
                  toast.error(`Failed to create scheduler after ${duration.toFixed(0)}ms: ${error.message}`);
                }
              });
            } catch (error) {
              // Fallback to regular scheduler workflow if optimized fails
              console.warn('Optimized scheduler workflow failed, trying regular workflow:', error);
              try {
                const result = await createSchedulerWorkflow({
                  apiClient,
                  session,
                  groupId,
                  scheduleData,
                  onSuccess: (scheduler, shifts) => {
                    setSchedules(prev => [...shifts, ...prev]);
                    setShowCreateSchedule(false);
                    toast.success(`Scheduler "${scheduler.display_name}" created with ${shifts.length} shift(s)! (fallback)`);
                  },
                  onError: (error) => {
                    toast.error(error.message || 'Failed to create scheduler');
                  }
                });
              } catch (fallbackError) {
                console.error('Both optimized and regular workflows failed:', fallbackError);
                toast.error('Failed to create schedule. Please try again.');
              }
            }
          }}
        />
      )}

      {/* Optimized Edit Schedule Modal */}
      {showEditSchedule && editingScheduler && (
        <OptimizedCreateScheduleModal
          isOpen={showEditSchedule}
          onClose={() => {
            setShowEditSchedule(false);
            setEditingScheduler(null);
          }}
          members={members}
          groupId={groupId}
          session={session}
          existingSchedules={schedules}
          mode="edit"
          schedulerData={editingScheduler}
          onSubmit={async (scheduleData) => {
            try {
              // Use update workflow for edit mode
              const result = await updateSchedulerWorkflow({
                apiClient,
                session,
                groupId,
                schedulerId: editingScheduler.id,
                scheduleData,
                onProgress: (message) => {
                  console.log('Progress:', message);
                },
                onSuccess: (scheduler, shifts) => {
                  // Update shifts in the schedule list
                  setSchedules(prev => {
                    // Remove old shifts from this scheduler
                    const filtered = prev.filter(s => s.scheduler_id !== editingScheduler.id);
                    // Add new shifts
                    return [...shifts, ...filtered];
                  });
                  setShowEditSchedule(false);
                  setEditingScheduler(null);

                  toast.success(
                    `Scheduler "${scheduler.display_name || scheduler.name}" updated with ${shifts.length} shift(s)!`,
                    { duration: 4000 }
                  );
                },
                onError: (error) => {
                  toast.error(`Failed to update scheduler: ${error.message}`);
                }
              });
            } catch (error) {
              console.error('Failed to update scheduler:', error);
              toast.error('Failed to update scheduler. Please try again.');
            }
          }}
        />
      )}

      {/* Override Creation Modal */}
      {showCreateOverride && (
        <CreateOverrideModal
          isOpen={showCreateOverride}
          onClose={() => {
            setShowCreateOverride(false);
            setSelectedScheduleForOverride(null);
          }}
          schedule={selectedScheduleForOverride}
          groupMembers={members}
          onOverrideCreated={handleOverrideCreated}
        />
      )}

      {/* Shift Swap Modal */}
      {showShiftSwap && (
        <ShiftSwapModal
          isOpen={showShiftSwap}
          onClose={() => {
            setShowShiftSwap(false);
            setSelectedScheduleForSwap(null);
          }}
          currentSchedule={selectedScheduleForSwap}
          allSchedules={schedules}
          groupMembers={members}
          onSwapRequested={handleShiftSwapRequested}
        />
      )}

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

      {/* Toast Notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          // Styling
          style: {
            background: '#363636',
            color: '#fff',
          },
          // Default options for all toasts
          duration: 4000,
          // Success
          success: {
            duration: 3000,
            style: {
              background: 'green',
            },
          },
          // Error
          error: {
            duration: 5000,
            style: {
              background: 'red',
            },
          },
        }}
      />
    </div>
  );
}
