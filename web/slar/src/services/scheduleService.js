/**
 * Schedule Service
 * Handles schedule-related API operations and business logic
 */

import { transformScheduleDataWithRotation } from './scheduleTransformer';

/**
 * Transform frontend schedule data to scheduler + shifts format
 * @param {Object} scheduleData - Frontend schedule data
 * @returns {Object} Scheduler data with shifts
 */
export const transformToSchedulerFormat = (scheduleData) => {
  console.log('🔄 Transforming to scheduler format:', scheduleData);
  
  // Extract scheduler info from schedule data
  const schedulerName = scheduleData.schedulerName || 
                       scheduleData.teamName || 
                       scheduleData.name || 
                       'default';
  
  const schedulerDisplayName = scheduleData.schedulerDisplayName || 
                              scheduleData.teamDisplayName || 
                              scheduleData.displayName || 
                              `${schedulerName} Team`;

  // Transform schedule data to shifts
  const backendSchedules = transformScheduleDataWithRotation(scheduleData);
  
  const shifts = backendSchedules.map(schedule => ({
    user_id: schedule.user_id,
    shift_type: schedule.schedule_type || 'custom',
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    is_recurring: schedule.is_recurring || false,
    rotation_days: schedule.rotation_days || 0,
    schedule_scope: schedule.schedule_scope || 'group',
    service_id: schedule.service_id || null
  }));

  return {
    scheduler: {
      name: schedulerName,
      display_name: schedulerDisplayName,
      description: scheduleData.description || `Scheduler for ${schedulerDisplayName}`,
      rotation_type: scheduleData.rotationType || 'manual'
    },
    shifts: shifts
  };
};

/**
 * Create multiple schedules with proper error handling
 * @param {Object} apiClient - API client instance
 * @param {string} groupId - Group ID
 * @param {Array} scheduleData - Array of backend schedule objects
 * @returns {Promise<Array>} Array of created schedules
 * @throws {Error} If any schedule creation fails
 */
export const createMultipleSchedules = async (apiClient, groupId, scheduleData) => {
  console.log(`📅 Creating ${scheduleData.length} schedules for group ${groupId}`);
  
  const promises = scheduleData.map(schedule => 
    apiClient.createSchedule(groupId, schedule)
  );
  
  try {
    const newSchedules = await Promise.all(promises);
    console.log(`✅ Successfully created ${newSchedules.length} schedules`);
    return newSchedules;
  } catch (error) {
    console.error('❌ Failed to create schedules:', error);
    throw new Error(`Failed to create schedules: ${error.message || 'Unknown error'}`);
  }
};

/**
 * Validate session authentication
 * @param {Object} session - Session object
 * @throws {Error} If not authenticated
 */
export const validateAuthentication = (session) => {
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
};

/**
 * Create scheduler with shifts using new architecture
 * @param {Object} apiClient - API client instance
 * @param {string} groupId - Group ID
 * @param {Object} schedulerData - Scheduler data with shifts
 * @returns {Promise<Object>} Created scheduler with shifts
 * @throws {Error} If creation fails
 */
export const createSchedulerWithShifts = async (apiClient, groupId, schedulerData) => {
  console.log(`👥 Creating scheduler with ${schedulerData.shifts?.length || 0} shifts for group ${groupId}`);
  
  try {
    const response = await apiClient.createSchedulerWithShifts(groupId, schedulerData);
    console.log('✅ Successfully created scheduler with shifts:', response);
    return response;
  } catch (error) {
    console.error('❌ Failed to create scheduler with shifts:', error);
    throw new Error(`Failed to create scheduler: ${error.message || 'Unknown error'}`);
  }
};

/**
 * NEW: Complete scheduler creation workflow (replaces schedule workflow)
 * @param {Object} params - Parameters object
 * @param {Object} params.apiClient - API client instance
 * @param {Object} params.session - Session object
 * @param {string} params.groupId - Group ID
 * @param {Object} params.scheduleData - Frontend schedule data
 * @param {Function} params.onSuccess - Success callback
 * @param {Function} params.onError - Error callback
 * @returns {Promise<Object>} Created scheduler with shifts
 */
export const createSchedulerWorkflow = async ({
  apiClient,
  session,
  groupId,
  scheduleData,
  onSuccess,
  onError
}) => {
  try {
    // 1. Validate authentication
    validateAuthentication(session);
    
    // 2. Set API token
    apiClient.setToken(session.access_token);
    
    // 3. Debug log
    console.log('🔍 Received scheduleData for scheduler creation:', scheduleData);
    
    // 4. Transform frontend data to scheduler + shifts format
    const schedulerData = transformToSchedulerFormat(scheduleData);
    
    // 5. Create scheduler with shifts via new API
    const result = await createSchedulerWithShifts(apiClient, groupId, schedulerData);
    
    // 6. Handle success
    if (onSuccess) {
      onSuccess(result.scheduler, result.shifts);
    }
    
    return result;
    
  } catch (error) {
    console.error('Failed to create scheduler:', error);
    
    // Handle error callback
    if (onError) {
      onError(error);
    }
    
    throw error;
  }
};

/**
 * NEW: Update scheduler workflow
 * @param {Object} params - Parameters object
 * @param {Object} params.apiClient - API client instance
 * @param {Object} params.session - Session object
 * @param {string} params.groupId - Group ID
 * @param {string} params.schedulerId - Scheduler ID to update
 * @param {Object} params.scheduleData - Frontend schedule data
 * @param {Function} params.onSuccess - Success callback
 * @param {Function} params.onError - Error callback
 * @returns {Promise<Object>} Updated scheduler with shifts
 */
export const updateSchedulerWorkflow = async ({
  apiClient,
  session,
  groupId,
  schedulerId,
  scheduleData,
  onSuccess,
  onError
}) => {
  try {
    // 1. Validate authentication
    validateAuthentication(session);
    
    // 2. Set API token
    apiClient.setToken(session.access_token);
    
    // 3. Debug log
    console.log('🔍 Received scheduleData for scheduler update:', scheduleData);
    
    // 4. Transform frontend data to scheduler + shifts format
    const schedulerData = transformToSchedulerFormat(scheduleData);
    
    // 5. Update scheduler with shifts via API
    const result = await apiClient.updateSchedulerWithShifts(groupId, schedulerId, schedulerData);
    
    // 6. Handle success
    if (onSuccess) {
      onSuccess(result.scheduler, result.shifts);
    }
    
    return result;
    
  } catch (error) {
    console.error('Failed to update scheduler:', error);
    
    // Handle error callback
    if (onError) {
      onError(error);
    }
    
    throw error;
  }
};

/**
 * UPDATED: Complete schedule creation workflow (now uses scheduler architecture)
 * @param {Object} params - Parameters object
 * @param {Object} params.apiClient - API client instance
 * @param {Object} params.session - Session object
 * @param {string} params.groupId - Group ID
 * @param {Object} params.scheduleData - Frontend schedule data
 * @param {Function} params.onSuccess - Success callback
 * @param {Function} params.onError - Error callback
 * @returns {Promise<Array>} Array of created schedules (shifts)
 */
export const createScheduleWorkflow = async ({
  apiClient,
  session,
  groupId,
  scheduleData,
  onSuccess,
  onError
}) => {
  try {
    // 1. Validate authentication
    validateAuthentication(session);
    
    // 2. Set API token
    apiClient.setToken(session.access_token);
    
    // 3. Debug log
    console.log('🔍 Legacy schedule workflow - converting to scheduler format:', scheduleData);
    
    // 4. Try new scheduler architecture first
    try {
      const schedulerData = transformToSchedulerFormat(scheduleData);
      const result = await createSchedulerWithShifts(apiClient, groupId, schedulerData);
      
      // Extract shifts for backward compatibility
      const shifts = result.shifts || [];
      
      if (onSuccess) {
        onSuccess(shifts);
      }
      
      return shifts;
      
    } catch (schedulerError) {
      console.warn('Scheduler creation failed, falling back to individual schedule creation:', schedulerError);
      
      // Fallback: Create individual schedules using legacy API
      const backendSchedules = transformScheduleDataWithRotation(scheduleData);
      const newSchedules = await createMultipleSchedules(apiClient, groupId, backendSchedules);
      
      if (onSuccess) {
        onSuccess(newSchedules);
      }
      
      return newSchedules;
    }
    
  } catch (error) {
    console.error('Failed to create schedule:', error);
    
    // Handle error callback
    if (onError) {
      onError(error);
    }
    
    throw error;
  }
};

/**
 * Schedule management service with common operations
 */
export class ScheduleManager {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Create schedules with rotation logic
   * @param {Object} params - Parameters
   * @returns {Promise<Array>} Created schedules
   */
  async createSchedules({ session, groupId, scheduleData, onSuccess, onError }) {
    return createScheduleWorkflow({
      apiClient: this.apiClient,
      session,
      groupId,
      scheduleData,
      onSuccess,
      onError
    });
  }

  /**
   * Fetch group shifts (all shifts with scheduler context)
   * @param {string} groupId - Group ID
   * @param {string} token - Access token
   * @returns {Promise<Array>} Array of shifts
   */
  async fetchGroupSchedules(groupId, token) {
    try {
      this.apiClient.setToken(token);
      const shiftsData = await this.apiClient.getGroupShifts(groupId);
      return shiftsData.shifts || [];
    } catch (error) {
      console.error('Failed to fetch shifts:', error);
      throw error;
    }
  }

  /**
   * Delete a schedule
   * @param {string} scheduleId - Schedule ID
   * @param {string} token - Access token
   * @returns {Promise<void>}
   */
  async deleteSchedule(scheduleId, token) {
    try {
      this.apiClient.setToken(token);
      await this.apiClient.deleteSchedule(scheduleId);
      console.log(`✅ Successfully deleted schedule ${scheduleId}`);
    } catch (error) {
      console.error('Failed to delete schedule:', error);
      throw error;
    }
  }
}
