/**
 * Schedule Data Transformation and Validation Service
 * Handles conversion between frontend and backend schedule formats
 */

/**
 * Calculate shift duration in days based on shift length type
 * @param {string} shiftLength - 'one_day', 'one_week', 'two_weeks', 'one_month'
 * @returns {number} Number of days
 */
export const getShiftDurationDays = (shiftLength) => {
  switch (shiftLength) {
    case 'one_day': return 1;
    case 'one_week': return 7;
    case 'two_weeks': return 14;
    case 'one_month': return 30;
    default: return 7;
  }
};

/**
 * Validate date and time strings
 * @param {Date} startDateTime - Start date object
 * @param {Date} endDateTime - End date object
 * @throws {Error} If dates are invalid
 */
export const validateDateTimes = (startDateTime, endDateTime) => {
  if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
    throw new Error('Invalid date/time in schedule configuration');
  }
  
  if (endDateTime <= startDateTime) {
    throw new Error('End time must be after start time');
  }
};

/**
 * Calculate end date time for a rotation
 * @param {Object} rotation - Rotation configuration
 * @returns {Date} End date time
 */
export const calculateEndDateTime = (rotation) => {
  if (rotation.hasEndDate && rotation.endDate && rotation.endTime) {
    return new Date(rotation.endDate + 'T' + rotation.endTime + ':00.000Z');
  } else {
    // Default to end of day (23:59) of start date
    return new Date(rotation.startDate + 'T23:59:59.000Z');
  }
};

/**
 * Helper: Get day of week as number (0 = Sunday, 6 = Saturday)
 */
const getDayOfWeekNumber = (dayName) => {
  const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  return days[dayName.toLowerCase()] ?? 1; // Default to Monday
};

/**
 * Helper: Calculate next occurrence of a specific day from a given date
 */
const getNextDayOfWeek = (fromDate, targetDayOfWeek, includeToday = true) => {
  const result = new Date(fromDate);
  const currentDay = result.getUTCDay();
  let daysToAdd = targetDayOfWeek - currentDay;
  
  if (daysToAdd < 0 || (!includeToday && daysToAdd === 0)) {
    daysToAdd += 7;
  }
  
  result.setUTCDate(result.getUTCDate() + daysToAdd);
  return result;
};

/**
 * Calculate member-specific start and end times based on rotation
 * @param {Object} rotation - Rotation configuration
 * @param {number} memberIndex - Index of member in the rotation (shift index, not just member)
 * @returns {Object} {memberStartTime, memberEndTime}
 */
export const calculateMemberTimes = (rotation, memberIndex) => {
  const shiftDurationDays = getShiftDurationDays(rotation.shiftLength);
  const rotationStartDateTime = new Date(rotation.startDate + 'T' + rotation.startTime + ':00.000Z');
  
  // Parse handoff time
  const [handoffHours, handoffMinutes] = rotation.handoffTime ? 
    rotation.handoffTime.split(':').map(n => parseInt(n)) : [0, 0];
  
  // Get handoff day of week
  const handoffDayOfWeek = rotation.handoffDay ? 
    getDayOfWeekNumber(rotation.handoffDay) : null;
  
  let memberStartTime, memberEndTime;
  
  if (memberIndex === 0) {
    // First shift: starts at rotation start time
    memberStartTime = new Date(rotationStartDateTime);
    
    // End at first handoff day/time
    if (handoffDayOfWeek !== null) {
      memberEndTime = getNextDayOfWeek(memberStartTime, handoffDayOfWeek, false);
      memberEndTime.setUTCHours(handoffHours, handoffMinutes, 0, 0);
    } else {
      // No handoff day specified, use simple duration
      memberEndTime = new Date(memberStartTime);
      memberEndTime.setUTCDate(memberStartTime.getUTCDate() + shiftDurationDays);
      memberEndTime.setUTCHours(handoffHours, handoffMinutes, 0, 0);
    }
  } else {
    // Subsequent shifts: start at previous shift end (which is a handoff time)
    // Calculate first handoff time
    const firstHandoffTime = new Date(rotationStartDateTime);
    if (handoffDayOfWeek !== null) {
      const firstHandoff = getNextDayOfWeek(firstHandoffTime, handoffDayOfWeek, false);
      firstHandoff.setUTCHours(handoffHours, handoffMinutes, 0, 0);
      
      // Each subsequent shift starts at first handoff + (memberIndex * shiftDurationDays)
      memberStartTime = new Date(firstHandoff);
      memberStartTime.setUTCDate(firstHandoff.getUTCDate() + ((memberIndex - 1) * shiftDurationDays));
    } else {
      // No handoff day, simple calculation
      memberStartTime = new Date(rotationStartDateTime);
      memberStartTime.setUTCDate(rotationStartDateTime.getUTCDate() + (memberIndex * shiftDurationDays));
      memberStartTime.setUTCHours(handoffHours, handoffMinutes, 0, 0);
    }
    
    // End time is always shiftDurationDays from start
    memberEndTime = new Date(memberStartTime);
    memberEndTime.setUTCDate(memberStartTime.getUTCDate() + shiftDurationDays);
  }
  
  return { memberStartTime, memberEndTime };
};

/**
 * Transform single rotation to backend schedule format for one member
 * @param {Object} rotation - Frontend rotation object
 * @param {Object} member - Member object
 * @param {number} memberIndex - Index of member in rotation
 * @returns {Object} Backend schedule object
 */
export const transformRotationToSchedule = (rotation, member, memberIndex) => {
  const { memberStartTime, memberEndTime } = calculateMemberTimes(rotation, memberIndex);
  const shiftDurationDays = getShiftDurationDays(rotation.shiftLength);
  
  // Validate times
  validateDateTimes(memberStartTime, memberEndTime);
  
  return {
    user_id: member.user_id,
    schedule_type: 'custom',
    start_time: memberStartTime.toISOString(),
    end_time: memberEndTime.toISOString(),
    is_recurring: false,
    rotation_days: shiftDurationDays
  };
};

/**
 * Generate multiple shifts for a rotation over a specified period
 * @param {Object} rotation - Rotation configuration
 * @param {Array} members - Array of member objects
 * @param {number} weeksAhead - Number of weeks to generate (default: 52 for 1 year)
 * @returns {Array} Array of backend schedule objects for the entire period
 */
export const generateRotationShifts = (rotation, members, weeksAhead = 52) => {
  const backendSchedules = [];
  const shiftDurationDays = getShiftDurationDays(rotation.shiftLength);
  const rotationStartDateTime = new Date(rotation.startDate + 'T' + rotation.startTime + ':00.000Z');

  // Calculate total number of shifts to generate
  const totalDays = weeksAhead * 7;
  const totalShifts = Math.ceil(totalDays / shiftDurationDays);

  // Parse handoff settings
  const [handoffHours, handoffMinutes] = rotation.handoffTime ? 
    rotation.handoffTime.split(':').map(n => parseInt(n)) : [0, 0];
  const handoffDayOfWeek = rotation.handoffDay ? 
    getDayOfWeekNumber(rotation.handoffDay) : null;

  console.log(`🔄 generateRotationShifts called with:`, {
    rotation: rotation.name || 'Unnamed',
    shiftLength: rotation.shiftLength,
    shiftDurationDays,
    weeksAhead,
    totalDays,
    totalShifts,
    membersCount: members.length,
    startDate: rotation.startDate,
    startTime: rotation.startTime,
    handoffDay: rotation.handoffDay,
    handoffTime: rotation.handoffTime
  });

  // Track the actual end time of the previous shift to ensure continuous coverage
  let previousShiftEndTime = null;

  // Generate shifts for the entire period
  for (let shiftIndex = 0; shiftIndex < totalShifts; shiftIndex++) {
    const memberIndex = shiftIndex % members.length;
    const member = members[memberIndex];

    // Calculate shift start and end times using the same logic as calculateMemberTimes
    let shiftStartTime, shiftEndTime;
    
    if (shiftIndex === 0) {
      // First shift starts at rotation start time
      shiftStartTime = new Date(rotationStartDateTime);
      
      // End at next handoff day/time
      if (handoffDayOfWeek !== null) {
        shiftEndTime = getNextDayOfWeek(shiftStartTime, handoffDayOfWeek, false);
        shiftEndTime.setUTCHours(handoffHours, handoffMinutes, 0, 0);
      } else {
        shiftEndTime = new Date(shiftStartTime);
        shiftEndTime.setUTCDate(shiftStartTime.getUTCDate() + shiftDurationDays);
        shiftEndTime.setUTCHours(handoffHours, handoffMinutes, 0, 0);
      }
    } else {
      // Subsequent shifts start at previous shift end (continuous coverage)
      shiftStartTime = new Date(previousShiftEndTime);
      
      // End at shiftDurationDays later
      shiftEndTime = new Date(shiftStartTime);
      shiftEndTime.setUTCDate(shiftStartTime.getUTCDate() + shiftDurationDays);
    }

    try {
      // Validate times
      validateDateTimes(shiftStartTime, shiftEndTime);

      const backendSchedule = {
        user_id: member.user_id,
        schedule_type: 'custom',
        start_time: shiftStartTime.toISOString(),
        end_time: shiftEndTime.toISOString(),
        is_recurring: false,
        rotation_days: shiftDurationDays
      };

      backendSchedules.push(backendSchedule);

      // Update previous shift end time for next iteration
      previousShiftEndTime = shiftEndTime;

      if (shiftIndex < 5) { // Log first 5 shifts for debugging
        console.log(`👤 Shift ${shiftIndex + 1} - Member ${memberIndex + 1} (${member.user_name}):`, {
          start: backendSchedule.start_time,
          end: backendSchedule.end_time
        });
      }

    } catch (error) {
      throw new Error(`Invalid schedule timing for ${member.user_name} at shift ${shiftIndex + 1}: ${error.message}`);
    }
  }

  console.log(`✅ Generated ${backendSchedules.length} shifts total`);
  return backendSchedules;
};

/**
 * Transform frontend scheduleData to backend format with rotation logic
 * @param {Object} scheduleData - Frontend schedule data
 * @param {Object} options - Options for transformation
 * @param {number} options.weeksAhead - Number of weeks to generate (default: 52 for 1 year)
 * @param {boolean} options.generateYearlyShifts - Whether to generate shifts for entire year (default: true)
 * @returns {Array} Array of backend schedule objects
 */
export const transformScheduleDataWithRotation = (scheduleData, options = {}) => {
  if (!scheduleData.rotations || !scheduleData.members ||
      scheduleData.rotations.length === 0 || scheduleData.members.length === 0) {
    throw new Error('Please select members and configure schedule details');
  }

  const { weeksAhead = 52, generateYearlyShifts = true } = options;
  const backendSchedules = [];

  console.log('🔍 transformScheduleDataWithRotation called with:', {
    rotationsCount: scheduleData.rotations.length,
    membersCount: scheduleData.members.length,
    options: { weeksAhead, generateYearlyShifts }
  });

  for (const rotation of scheduleData.rotations) {
    console.log('🔄 Processing rotation:', rotation);

    if (generateYearlyShifts) {
      console.log(`📅 Generating yearly shifts for ${weeksAhead} weeks`);
      // Generate shifts for the entire year
      const yearlyShifts = generateRotationShifts(rotation, scheduleData.members, weeksAhead);
      console.log(`✅ Generated ${yearlyShifts.length} yearly shifts`);
      backendSchedules.push(...yearlyShifts);
    } else {
      // Legacy behavior: Create schedules for each member with proper rotation timing (single shift per member)
      for (let memberIndex = 0; memberIndex < scheduleData.members.length; memberIndex++) {
        const member = scheduleData.members[memberIndex];

        try {
          const backendSchedule = transformRotationToSchedule(rotation, member, memberIndex);

          console.log(`👤 Member ${memberIndex + 1} (${member.user_name}):`, {
            start: backendSchedule.start_time,
            end: backendSchedule.end_time
          });

          backendSchedules.push(backendSchedule);
        } catch (error) {
          throw new Error(`Invalid schedule timing for ${member.user_name}: ${error.message}`);
        }
      }
    }
  }

  return backendSchedules;
};

/**
 * Transform frontend scheduleData to backend format with yearly rotation generation
 * This is a convenience function that calls transformScheduleDataWithRotation with yearly generation enabled
 * @param {Object} scheduleData - Frontend schedule data
 * @param {number} weeksAhead - Number of weeks to generate (default: 52 for 1 year)
 * @returns {Array} Array of backend schedule objects for the entire year
 */
export const transformScheduleDataWithYearlyRotation = (scheduleData, weeksAhead = 52) => {
  return transformScheduleDataWithRotation(scheduleData, {
    weeksAhead,
    generateYearlyShifts: true
  });
};

/**
 * Transform frontend scheduleData to backend format (single shift per member)
 * This is a convenience function that calls transformScheduleDataWithRotation with yearly generation disabled
 * @param {Object} scheduleData - Frontend schedule data
 * @returns {Array} Array of backend schedule objects (single shift per member)
 */
export const transformScheduleDataSingleShift = (scheduleData) => {
  return transformScheduleDataWithRotation(scheduleData, {
    generateYearlyShifts: false
  });
};

/**
 * Transform frontend scheduleData to backend format (legacy simple logic)
 * @param {Object} scheduleData - Frontend schedule data
 * @returns {Array} Array of backend schedule objects
 * @deprecated Use transformScheduleDataWithRotation for proper rotation logic
 */
export const transformScheduleDataSimple = (scheduleData) => {
  if (!scheduleData.rotations || !scheduleData.members || 
      scheduleData.rotations.length === 0 || scheduleData.members.length === 0) {
    throw new Error('Please select members and configure schedule details');
  }

  const backendSchedules = [];

  for (const rotation of scheduleData.rotations) {
    const endDateTime = calculateEndDateTime(rotation);
    const startDateTime = new Date(rotation.startDate + 'T' + rotation.startTime + ':00.000Z');
    
    // Validate dates
    validateDateTimes(startDateTime, endDateTime);
    
    for (const member of scheduleData.members) {
      const backendScheduleData = {
        user_id: member.user_id,
        schedule_type: 'custom',
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        is_recurring: false,
        rotation_days: 0
      };
      
      backendSchedules.push(backendScheduleData);
    }
  }

  return backendSchedules;
};
