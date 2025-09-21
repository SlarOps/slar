/**
 * Debug script to test why only 2 shifts are being generated
 */

// Simulate the exact data structure from the API response
const mockScheduleData = {
  rotations: [{
    id: 1,
    name: 'Test Rotation',
    shiftLength: 'one_week',
    handoffTime: '17:00',
    startDate: '2025-09-12',
    startTime: '00:04',
    hasEndDate: false,
    endDate: '',
    endTime: '23:59'
  }],
  members: [
    { user_id: '5a22f755-bf7f-4a17-8e19-a84d0e42e824', user_name: 'User 1' },
    { user_id: 'c40ceb2e-0fbc-463a-be18-6d8f522bf48b', user_name: 'User 2' }
  ],
  schedulerName: 'test-scheduler',
  schedulerDisplayName: 'Test Scheduler'
};

// Copy the exact functions from scheduleTransformer.js
const getShiftDurationDays = (shiftLength) => {
  switch (shiftLength) {
    case 'one_day': return 1;
    case 'one_week': return 7;
    case 'two_weeks': return 14;
    case 'one_month': return 30;
    default: return 7;
  }
};

const validateDateTimes = (startDateTime, endDateTime) => {
  if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
    throw new Error('Invalid date/time in schedule configuration');
  }
  
  if (endDateTime <= startDateTime) {
    throw new Error('End time must be after start time');
  }
};

const generateRotationShifts = (rotation, members, weeksAhead = 52) => {
  const backendSchedules = [];
  const shiftDurationDays = getShiftDurationDays(rotation.shiftLength);
  const rotationStartDateTime = new Date(rotation.startDate + 'T' + rotation.startTime + ':00.000Z');
  
  // Calculate total number of shifts to generate
  const totalDays = weeksAhead * 7;
  const totalShifts = Math.ceil(totalDays / shiftDurationDays);
  
  console.log(`🔄 generateRotationShifts called with:`, {
    rotation: rotation.name || 'Unnamed',
    shiftLength: rotation.shiftLength,
    shiftDurationDays,
    weeksAhead,
    totalDays,
    totalShifts,
    membersCount: members.length,
    startDate: rotation.startDate,
    startTime: rotation.startTime
  });
  
  // Generate shifts for the entire period
  for (let shiftIndex = 0; shiftIndex < totalShifts; shiftIndex++) {
    const memberIndex = shiftIndex % members.length;
    const member = members[memberIndex];
    
    // Calculate shift start time
    const shiftStartTime = new Date(rotationStartDateTime);
    shiftStartTime.setDate(rotationStartDateTime.getDate() + (shiftIndex * shiftDurationDays));
    
    // Calculate shift end time
    const shiftEndTime = new Date(shiftStartTime);
    shiftEndTime.setDate(shiftStartTime.getDate() + shiftDurationDays);
    
    // Apply handoff time if specified
    if (rotation.handoffTime) {
      const [handoffHours, handoffMinutes] = rotation.handoffTime.split(':');
      shiftEndTime.setHours(parseInt(handoffHours), parseInt(handoffMinutes), 0, 0);
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
      
      if (shiftIndex < 10) { // Log first 10 shifts for debugging
        console.log(`👤 Shift ${shiftIndex + 1} - Member ${memberIndex + 1} (${member.user_name}):`, {
          start: backendSchedule.start_time,
          end: backendSchedule.end_time
        });
      }
      
    } catch (error) {
      console.error(`❌ Error generating shift ${shiftIndex + 1}:`, error.message);
      throw new Error(`Invalid schedule timing for ${member.user_name} at shift ${shiftIndex + 1}: ${error.message}`);
    }
  }
  
  console.log(`✅ Generated ${backendSchedules.length} shifts total`);
  return backendSchedules;
};

const transformScheduleDataWithRotation = (scheduleData, options = {}) => {
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
      console.log('📅 Generating single shift per member (legacy mode)');
      // Legacy behavior: Create schedules for each member with proper rotation timing (single shift per member)
      for (let memberIndex = 0; memberIndex < scheduleData.members.length; memberIndex++) {
        const member = scheduleData.members[memberIndex];
        
        try {
          const shiftDurationDays = getShiftDurationDays(rotation.shiftLength);
          const rotationStartDateTime = new Date(rotation.startDate + 'T' + rotation.startTime + ':00.000Z');
          
          const memberStartTime = new Date(rotationStartDateTime);
          memberStartTime.setDate(rotationStartDateTime.getDate() + (memberIndex * shiftDurationDays));
          
          const memberEndTime = new Date(memberStartTime);
          memberEndTime.setDate(memberStartTime.getDate() + shiftDurationDays);
          
          if (rotation.handoffTime) {
            const [handoffHours, handoffMinutes] = rotation.handoffTime.split(':');
            memberEndTime.setHours(parseInt(handoffHours), parseInt(handoffMinutes), 0, 0);
          }
          
          validateDateTimes(memberStartTime, memberEndTime);
          
          const backendSchedule = {
            user_id: member.user_id,
            schedule_type: 'custom',
            start_time: memberStartTime.toISOString(),
            end_time: memberEndTime.toISOString(),
            is_recurring: false,
            rotation_days: shiftDurationDays
          };
          
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

  console.log(`🎯 Final result: ${backendSchedules.length} total shifts`);
  return backendSchedules;
};

// Test the function
console.log('🧪 Testing transformScheduleDataWithRotation with yearly generation...\n');

try {
  // Test 1: Default yearly generation (52 weeks)
  console.log('=== Test 1: Default yearly generation (52 weeks) ===');
  const yearlyShifts = transformScheduleDataWithRotation(mockScheduleData);
  console.log(`Result: ${yearlyShifts.length} shifts generated\n`);

  // Test 2: Custom period (4 weeks)
  console.log('=== Test 2: Custom period (4 weeks) ===');
  const customShifts = transformScheduleDataWithRotation(mockScheduleData, { weeksAhead: 4 });
  console.log(`Result: ${customShifts.length} shifts generated\n`);

  // Test 3: Legacy mode (single shift per member)
  console.log('=== Test 3: Legacy mode (single shift per member) ===');
  const legacyShifts = transformScheduleDataWithRotation(mockScheduleData, { generateYearlyShifts: false });
  console.log(`Result: ${legacyShifts.length} shifts generated\n`);

} catch (error) {
  console.error('❌ Test failed:', error.message);
}

console.log('🎉 Debug test completed!');

// Export for browser console testing
if (typeof window !== 'undefined') {
  window.debugTransformer = {
    transformScheduleDataWithRotation,
    generateRotationShifts,
    mockScheduleData
  };
}
