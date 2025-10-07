/**
 * Optimized Schedule Service with performance improvements
 */

import { transformScheduleDataWithRotation } from './scheduleTransformer';

/**
 * Transform frontend schedule data to optimized scheduler + shifts format
 * @param {Object} scheduleData - Frontend schedule data
 * @returns {Object} Optimized scheduler data with shifts
 */
export const transformToOptimizedSchedulerFormat = (scheduleData) => {
  console.log('🚀 Transforming to optimized scheduler format:', scheduleData);
  
  // Extract scheduler info from schedule data
  const schedulerName = scheduleData.schedulerName || 
                       scheduleData.teamName || 
                       scheduleData.name || 
                       'default';
  
  const schedulerDisplayName = scheduleData.schedulerDisplayName || 
                              scheduleData.teamDisplayName || 
                              scheduleData.displayName || 
                              `${schedulerName} Team`;

  // Transform schedule data to shifts with optimizations
  const backendSchedules = transformScheduleDataWithRotation(scheduleData);
  
  // Pre-validate and optimize shifts data
  const shifts = backendSchedules.map((schedule, index) => {
    const shift = {
      user_id: schedule.user_id,
      shift_type: schedule.schedule_type || 'custom',
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      is_recurring: schedule.is_recurring || false,
      rotation_days: schedule.rotation_days || 0,
      schedule_scope: schedule.schedule_scope || 'group',
      service_id: schedule.service_id || null
    };

    // Validate shift data
    if (!shift.user_id) {
      throw new Error(`Shift ${index + 1}: user_id is required`);
    }
    
    if (!shift.start_time || !shift.end_time) {
      throw new Error(`Shift ${index + 1}: start_time and end_time are required`);
    }

    return shift;
  });

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
 * Create scheduler with shifts using optimized API endpoint
 * @param {Object} apiClient - API client instance
 * @param {string} groupId - Group ID
 * @param {Object} schedulerData - Scheduler data with shifts
 * @returns {Promise<Object>} Created scheduler with shifts and performance metrics
 */
export const createSchedulerWithShiftsOptimized = async (apiClient, groupId, schedulerData) => {
  console.log(`⚡ Creating optimized scheduler with ${schedulerData.shifts?.length || 0} shifts for group ${groupId}`);
  
  const startTime = performance.now();
  
  try {
    // Use optimized endpoint if available, fallback to regular endpoint
    let response;
    try {
      response = await apiClient.createSchedulerWithShiftsOptimized(groupId, schedulerData);
    } catch (error) {
      console.warn('Optimized endpoint not available, falling back to regular endpoint:', error);
      response = await apiClient.createSchedulerWithShifts(groupId, schedulerData);
    }
    
    const duration = performance.now() - startTime;
    console.log(`✅ Successfully created optimized scheduler in ${duration.toFixed(2)}ms`);
    
    return {
      ...response,
      performance: {
        duration_ms: duration,
        frontend_processing: true
      }
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    console.error(`❌ Failed to create optimized scheduler after ${duration.toFixed(2)}ms:`, error);
    throw new Error(`Failed to create scheduler: ${error.message || 'Unknown error'}`);
  }
};

/**
 * Optimized scheduler creation workflow with enhanced UX
 * @param {Object} params - Parameters object
 * @param {Object} params.apiClient - API client instance
 * @param {Object} params.session - Session object
 * @param {string} params.groupId - Group ID
 * @param {Object} params.scheduleData - Frontend schedule data
 * @param {Function} params.onProgress - Progress callback (optional)
 * @param {Function} params.onSuccess - Success callback
 * @param {Function} params.onError - Error callback
 * @returns {Promise<Object>} Created scheduler with shifts
 */
export const createOptimizedSchedulerWorkflow = async ({
  apiClient,
  session,
  groupId,
  scheduleData,
  onProgress,
  onSuccess,
  onError
}) => {
  const startTime = performance.now();
  
  try {
    // 1. Validate authentication
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }
    
    onProgress && onProgress('Validating authentication...');
    
    // 2. Set API token
    apiClient.setToken(session.access_token);
    
    onProgress && onProgress('Preparing schedule data...');
    
    // 3. Transform and validate frontend data
    const schedulerData = transformToOptimizedSchedulerFormat(scheduleData);
    
    // 4. Additional client-side validation
    if (!schedulerData.scheduler.name) {
      throw new Error('Scheduler name is required');
    }
    
    if (!schedulerData.shifts || schedulerData.shifts.length === 0) {
      throw new Error('At least one shift is required');
    }
    
    onProgress && onProgress('Creating scheduler...');
    
    // 5. Create scheduler with optimized service
    const result = await createSchedulerWithShiftsOptimized(apiClient, groupId, schedulerData);
    
    onProgress && onProgress('Finalizing...');
    
    const totalDuration = performance.now() - startTime;
    
    // 6. Handle success with performance metrics
    const enhancedResult = {
      ...result,
      performance: {
        ...result.performance,
        total_frontend_duration_ms: totalDuration,
        shifts_count: result.shifts?.length || 0
      }
    };
    
    if (onSuccess) {
      onSuccess(enhancedResult.scheduler, enhancedResult.shifts, enhancedResult.performance);
    }
    
    console.log(`🎉 Optimized scheduler workflow completed in ${totalDuration.toFixed(2)}ms`);
    return enhancedResult;
    
  } catch (error) {
    const totalDuration = performance.now() - startTime;
    console.error(`❌ Optimized scheduler workflow failed after ${totalDuration.toFixed(2)}ms:`, error);
    
    // Handle error callback
    if (onError) {
      onError(error, { duration_ms: totalDuration });
    }
    
    throw error;
  }
};

/**
 * Validate schedule data before submission
 * @param {Object} scheduleData - Schedule data to validate
 * @returns {Object} Validation result with errors if any
 */
export const validateScheduleData = (scheduleData) => {
  const errors = [];
  
  // Validate basic fields
  if (!scheduleData.name || scheduleData.name.trim() === '') {
    errors.push('Schedule name is required');
  }
  
  if (!scheduleData.selectedMembers || scheduleData.selectedMembers.length === 0) {
    errors.push('At least one member must be selected');
  }
  
  if (!scheduleData.rotations || scheduleData.rotations.length === 0) {
    errors.push('At least one rotation is required');
  }
  
  // Validate rotations
  if (scheduleData.rotations) {
    scheduleData.rotations.forEach((rotation, index) => {
      if (!rotation.startDate) {
        errors.push(`Rotation ${index + 1}: Start date is required`);
      }
      
      if (!rotation.startTime) {
        errors.push(`Rotation ${index + 1}: Start time is required`);
      }
      
      if (!rotation.members || rotation.members.length === 0) {
        errors.push(`Rotation ${index + 1}: At least one member is required`);
      }
    });
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
};

/**
 * Get scheduler performance statistics
 * @param {Object} apiClient - API client instance
 * @param {string} groupId - Group ID
 * @returns {Promise<Object>} Performance statistics
 */
export const getSchedulerPerformanceStats = async (apiClient, groupId) => {
  try {
    const response = await apiClient.getSchedulerPerformanceStats(groupId);
    return response.stats;
  } catch (error) {
    console.error('Failed to get scheduler performance stats:', error);
    throw error;
  }
};

/**
 * Benchmark scheduler creation performance
 * @param {Object} apiClient - API client instance
 * @param {string} groupId - Group ID
 * @param {Object} testData - Test scheduler data
 * @param {number} iterations - Number of iterations (default: 1)
 * @returns {Promise<Object>} Benchmark results
 */
export const benchmarkSchedulerCreation = async (apiClient, groupId, testData, iterations = 1) => {
  try {
    const response = await apiClient.benchmarkSchedulerCreation(groupId, {
      ...testData,
      iterations: iterations
    });
    return response.benchmark_results;
  } catch (error) {
    console.error('Failed to benchmark scheduler creation:', error);
    throw error;
  }
};

/**
 * Optimized Schedule Manager with performance enhancements
 */
export class OptimizedScheduleManager {
  constructor(apiClient) {
    this.apiClient = apiClient;
    this.performanceMetrics = [];
  }

  /**
   * Create schedules with optimized workflow
   * @param {Object} params - Parameters
   * @returns {Promise<Object>} Created scheduler with performance metrics
   */
  async createSchedules({ session, groupId, scheduleData, onProgress, onSuccess, onError }) {
    return createOptimizedSchedulerWorkflow({
      apiClient: this.apiClient,
      session,
      groupId,
      scheduleData,
      onProgress,
      onSuccess: (scheduler, shifts, performance) => {
        // Store performance metrics
        this.performanceMetrics.push({
          timestamp: new Date(),
          operation: 'create_scheduler',
          performance: performance
        });
        
        if (onSuccess) {
          onSuccess(scheduler, shifts, performance);
        }
      },
      onError
    });
  }

  /**
   * Get performance metrics history
   * @returns {Array} Performance metrics
   */
  getPerformanceHistory() {
    return this.performanceMetrics;
  }

  /**
   * Clear performance metrics
   */
  clearPerformanceHistory() {
    this.performanceMetrics = [];
  }
}
