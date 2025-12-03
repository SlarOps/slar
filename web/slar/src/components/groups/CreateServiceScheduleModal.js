'use client';

import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';
import { Modal, ModalFooter, ModalButton, toast } from '../ui';

export default function CreateServiceScheduleModal({ 
  isOpen, 
  onClose, 
  service, 
  groupId, 
  members = [],
  onScheduleCreated
}) {
  const { session } = useAuth();
  const { currentOrg, currentProject } = useOrg();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    start_time: '',
    end_time: '',
    is_recurring: false,
    rotation_days: 7
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!session?.access_token || !service?.id) {
      toast.error('Authentication required');
      return;
    }

    if (!currentOrg?.id) {
      toast.error('Organization context required');
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

      // Create service-specific schedule
      const scheduleData = {
        ...formData,
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
        schedule_scope: 'service',
        service_id: service.id
      };

      const response = await apiClient.createServiceSchedule(groupId, service.id, scheduleData, rebacFilters);
      
      if (response.schedule) {
        onScheduleCreated && onScheduleCreated(response.schedule);
        onClose();
        toast.success(`Schedule created for ${service.name}!`);
        
        // Reset form
        setFormData({
          user_id: '',
          start_time: '',
          end_time: '',
          is_recurring: false,
          rotation_days: 7
        });
      }
    } catch (error) {
      console.error('Failed to create service schedule:', error);
      toast.error('Failed to create schedule: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getTomorrowDateTime = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0); // 9 AM
    return tomorrow.toISOString().slice(0, 16); // Format for datetime-local input
  };

  const getEndDateTime = () => {
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(17, 0, 0, 0); // 5 PM
    return end.toISOString().slice(0, 16);
  };

  if (!service) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div>
          <div className="text-lg font-semibold">Create Service Schedule</div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Create on-call schedule for <span className="font-medium">{service.name}</span>
          </p>
        </div>
      }
      size="md"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            Cancel
          </ModalButton>
          <ModalButton 
            variant="primary" 
            onClick={handleSubmit}
            loading={loading}
            type="submit"
          >
            Create Schedule
          </ModalButton>
        </ModalFooter>
      }
    >
      <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Service Info */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm">
                  <div className="font-medium text-blue-700 dark:text-blue-300">Service-specific Schedule</div>
                  <div className="text-blue-600 dark:text-blue-400">
                    This schedule will only apply to alerts from "{service.name}" and will override group-wide schedules.
                  </div>
                </div>
              </div>
            </div>

            {/* Assigned Member */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Assigned Member <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.user_id}
                onChange={(e) => setFormData(prev => ({ ...prev, user_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">Select team member...</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.user_name} ({member.user_email})
                  </option>
                ))}
              </select>
            </div>

            {/* Start Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={formData.start_time || getTomorrowDateTime()}
                onChange={(e) => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            {/* End Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={formData.end_time || getEndDateTime()}
                onChange={(e) => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            {/* Recurring Option */}
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_recurring}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_recurring: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Recurring schedule</span>
              </label>
              {formData.is_recurring && (
                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Rotation Days
                  </label>
                  <select
                    value={formData.rotation_days}
                    onChange={(e) => setFormData(prev => ({ ...prev, rotation_days: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value={1}>Daily (1 day)</option>
                    <option value={3}>Every 3 days</option>
                    <option value={7}>Weekly (7 days)</option>
                    <option value={14}>Bi-weekly (14 days)</option>
                    <option value={30}>Monthly (30 days)</option>
                  </select>
                </div>
              )}
            </div>

            {/* Option 1 Info */}
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-yellow-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.866-.833-2.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div className="text-sm">
                  <div className="font-medium text-yellow-700 dark:text-yellow-300">Option 1: Single Schedule per Service</div>
                  <div className="text-yellow-600 dark:text-yellow-400">
                    Each service can have maximum 1 active schedule. Creating this will replace any existing schedule for this service.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
    </Modal>
  );
}
