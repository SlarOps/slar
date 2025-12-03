'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';
import ScheduleTimeline from './ScheduleTimeline';
import ConfirmationModal from './ConfirmationModal';
import CreateOverrideModal from './CreateOverrideModal';
import OverrideDetailModal from './OverrideDetailModal';
import toast from 'react-hot-toast';

export default function MultiSchedulerTimeline({ groupId, members, onEditScheduler }) {
  const { session } = useAuth();
  const { currentOrg, currentProject } = useOrg();
  const [schedulers, setSchedulers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('');
  const timelineRef = useRef(null);

  // Confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'Confirm',
    isLoading: false
  });

  // Override modal state
  const [overrideModal, setOverrideModal] = useState({
    isOpen: false,
    shift: null
  });

  // Override detail modal state
  const [detailModal, setDetailModal] = useState({
    isOpen: false,
    shift: null,
    originalMember: null,
    currentMember: null
  });

  useEffect(() => {
    fetchSchedulerTimelines();
  }, [groupId, session, currentOrg?.id, currentProject?.id]);

  // Auto-refresh timeline when shifts data changes
  useEffect(() => {
    if (timelineRef.current && shifts.length > 0 && !loading) {
      console.log('Shifts data changed, refreshing timeline...', shifts.length, 'shifts');
      // Small delay to ensure React has updated all components
      const timer = setTimeout(() => {
        if (timelineRef.current) {
          try {
            timelineRef.current.refresh();
            console.log('Timeline auto-refreshed successfully');
          } catch (error) {
            console.warn('Failed to auto-refresh timeline:', error);
          }
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [shifts, loading]);

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

  const handleShiftClick = (shift) => {
    console.log('Shift clicked:', shift);

    // If shift has override, show detail modal
    // Otherwise show create override modal
    const hasOverride = shift.is_overridden || shift.override_id;

    if (hasOverride) {
      // IMPORTANT: Backend swaps user IDs when there's an override!
      // - shift.user_id = EFFECTIVE user (person actually on-call after override)
      // - shift.original_user_id = ORIGINAL user (person originally scheduled)
      const originalUserId = shift.original_user_id; // Person originally scheduled
      const effectiveUserId = shift.user_id; // Person actually on-call (override person)

      console.log('Override shift clicked:', { originalUserId, effectiveUserId, shift });

      const originalMember = members.find(m => m.user_id === originalUserId);
      const currentMember = members.find(m => m.user_id === effectiveUserId);

      setDetailModal({
        isOpen: true,
        shift: shift,
        originalMember: originalMember,
        currentMember: currentMember
      });
    } else {
      // Create new override
      setOverrideModal({
        isOpen: true,
        shift: shift
      });
    }
  };

  const handleOverrideCreated = async (override) => {
    console.log('Override created:', override);

    // Close the modal first
    setOverrideModal({ isOpen: false, shift: null });

    // Refresh the shifts data to show the override
    await fetchSchedulerTimelines();

    // Small delay to ensure state has updated
    await new Promise(resolve => setTimeout(resolve, 100));

    // Force timeline to refresh and unselect current item
    if (timelineRef.current) {
      try {
        // Unselect current selection
        const timeline = timelineRef.current.getTimeline();
        if (timeline && timeline.setSelection) {
          timeline.setSelection([]);
        }

        // Refresh timeline with new data
        timelineRef.current.refresh();
        console.log('Timeline refreshed after override creation');
      } catch (error) {
        console.warn('Failed to refresh timeline:', error);
      }
    }

    toast.success('Override created successfully!');
  };

  const handleRemoveOverride = (shift) => {
    const originalUserName = shift.original_user_name || 'Unknown User';
    const overrideUserName = shift.user_name || 'Unknown User';

    showConfirmation(
      'Remove Override',
      `Are you sure you want to remove this override? The shift will be restored to ${originalUserName} (originally scheduled person).`,
      async () => {
        setConfirmationModal(prev => ({ ...prev, isLoading: true }));

        if (!session?.access_token || !currentOrg?.id) {
          toast.error('Not authenticated');
          closeConfirmation();
          return;
        }

        if (!shift.override_id) {
          toast.error('Override ID not found');
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
          await apiClient.deleteOverride(groupId, shift.override_id, rebacFilters);

          // Close the detail modal
          setDetailModal({ isOpen: false, shift: null, originalMember: null, currentMember: null });

          // Refresh the shifts data
          await fetchSchedulerTimelines();

          // Small delay to ensure state has updated
          await new Promise(resolve => setTimeout(resolve, 100));

          // Force timeline to refresh and unselect current item
          if (timelineRef.current) {
            try {
              // Unselect current selection
              const timeline = timelineRef.current.getTimeline();
              if (timeline && timeline.setSelection) {
                timeline.setSelection([]);
              }

              // Refresh timeline with new data
              timelineRef.current.refresh();
              console.log('Timeline refreshed after override removal');
            } catch (error) {
              console.warn('Failed to refresh timeline:', error);
            }
          }

          toast.success('Override removed successfully');
          closeConfirmation();
        } catch (error) {
          console.error('Failed to remove override:', error);
          toast.error('Failed to remove override: ' + error.message);
          closeConfirmation();
        }
      },
      'Yes, Remove'
    );
  };

  const handleDeleteScheduler = (schedulerId, schedulerName) => {
    showConfirmation(
      'Delete Scheduler',
      `Are you sure you want to delete the scheduler "${schedulerName}"? This will also delete all associated shifts. This action cannot be undone.`,
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
          await apiClient.deleteScheduler(groupId, schedulerId, rebacFilters);

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
    // ReBAC: MUST have session AND org_id for tenant isolation
    if (!session?.access_token || !groupId || !currentOrg?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };

      // Fetch schedulers and shifts for the group
      const [schedulersResponse, shiftsResponse] = await Promise.all([
        apiClient.getGroupSchedulers(groupId, rebacFilters),
        apiClient.getGroupShifts(groupId, rebacFilters)
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
                className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === timeline.id
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

                  <div className="flex items-center gap-2">
                    {/* Edit Scheduler Button */}
                    {onEditScheduler && (
                      <button
                        onClick={() => onEditScheduler(currentTimeline.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title={`Edit scheduler "${currentTimeline.name}"`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                    )}

                    {/* Delete Scheduler Button */}
                    <button
                      onClick={() => handleDeleteScheduler(currentTimeline.id, currentTimeline.name)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title={`Delete scheduler "${currentTimeline.name}"`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>Type: Scheduler</span>
                  <span>•</span>
                  <span>{currentTimeline.schedule_count} shift{currentTimeline.schedule_count !== 1 ? 's' : ''}</span>
                </div>

                {/* Legend */}
                <div className="mt-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-4 rounded" style={{
                      backgroundImage: 'repeating-linear-gradient(45deg, #3b82f6, #3b82f6 10px, rgba(59, 130, 246, 0.7) 10px, rgba(59, 130, 246, 0.7) 20px)',
                      border: '1px dashed rgba(255,255,255,0.5)'
                    }}></div>
                    <span>Override shift (click to view details)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                    <span>Override indicator</span>
                  </div>
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
                  ref={timelineRef}
                  rotations={currentTimeline.schedules}
                  members={members}
                  selectedMembers={(() => {
                    // Get unique members from current scheduler shifts
                    // Include both original users AND effective users (from overrides)
                    const uniqueMembers = [];
                    const seenIds = new Set();

                    currentTimeline.schedules.forEach(shift => {
                      // IMPORTANT: Backend swaps user IDs when there's an override!
                      // - shift.user_id = EFFECTIVE user (person actually on-call)
                      // - shift.original_user_id = ORIGINAL user (person originally scheduled)
                      const effectiveUserId = shift.user_id;
                      const originalUserId = shift.original_user_id;

                      // Add effective user (the one actually on-call)
                      if (effectiveUserId && !seenIds.has(effectiveUserId)) {
                        seenIds.add(effectiveUserId);
                        const memberDetails = members.find(m => m.user_id === effectiveUserId);
                        if (memberDetails) {
                          uniqueMembers.push(memberDetails);
                        } else {
                          uniqueMembers.push({
                            user_id: effectiveUserId,
                            user_name: shift.user_name || 'Unknown User',
                            user_email: shift.user_email || '',
                            user_team: shift.user_team || ''
                          });
                        }
                      }

                      // Also add original user if different (for override context)
                      if (shift.is_overridden && originalUserId && originalUserId !== effectiveUserId && !seenIds.has(originalUserId)) {
                        seenIds.add(originalUserId);
                        const originalMember = members.find(m => m.user_id === originalUserId);
                        if (originalMember) {
                          uniqueMembers.push(originalMember);
                        } else {
                          // Fallback: Always create member from shift data for override context
                          // Use original_user_* fields if available, otherwise fall back to regular fields
                          uniqueMembers.push({
                            user_id: originalUserId,
                            user_name: shift.original_user_name || shift.user_name || 'Unknown User',
                            user_email: shift.original_user_email || shift.user_email || '',
                            user_team: shift.original_user_team || shift.user_team || ''
                          });
                        }
                      }
                    });

                    return uniqueMembers;
                  })()}
                  viewMode="2-week"
                  isVisible={true}
                  onShiftClick={handleShiftClick}
                  onRemoveOverride={handleRemoveOverride}
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

      {/* Override Modal */}
      <CreateOverrideModal
        isOpen={overrideModal.isOpen}
        onClose={() => setOverrideModal({ isOpen: false, shift: null })}
        shift={overrideModal.shift}
        members={members}
        groupId={groupId}
        session={session}
        onOverrideCreated={handleOverrideCreated}
      />

      {/* Override Detail Modal */}
      <OverrideDetailModal
        isOpen={detailModal.isOpen}
        onClose={() => setDetailModal({ isOpen: false, shift: null, originalMember: null, currentMember: null })}
        shift={detailModal.shift}
        originalMember={detailModal.originalMember}
        currentMember={detailModal.currentMember}
        onRemoveOverride={handleRemoveOverride}
      />
    </div>
  );
}