/**
 * Test script to verify the gap fix in schedule transformer
 * This script uses CommonJS require instead of ES modules to avoid module issues
 */

// Since we can't use ES modules easily, let's copy the essential functions here for testing
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
    startTime: rotation.startTime,
    handoffTime: rotation.handoffTime
  });

  // Track the actual end time of the previous shift to ensure continuous coverage
  let previousShiftEndTime = null;

  // Generate shifts for the entire period
  for (let shiftIndex = 0; shiftIndex < totalShifts; shiftIndex++) {
    const memberIndex = shiftIndex % members.length;
    const member = members[memberIndex];

    // Calculate shift start time
    let shiftStartTime;
    if (shiftIndex === 0) {
      // First shift starts at the rotation start time
      shiftStartTime = new Date(rotationStartDateTime);
    } else {
      // Subsequent shifts start exactly when the previous shift ended (continuous coverage)
      shiftStartTime = new Date(previousShiftEndTime);
    }

    // Calculate shift end time (duration from start time)
    const shiftEndTime = new Date(shiftStartTime);
    shiftEndTime.setDate(shiftStartTime.getDate() + shiftDurationDays);

    // Apply handoff time if specified
    if (rotation.handoffTime) {
      const [handoffHours, handoffMinutes] = rotation.handoffTime.split(':');
      console.log(`🕐 Applying handoff time ${rotation.handoffTime} to shift ${shiftIndex + 1}`);
      console.log(`   Before handoff: ${shiftEndTime.toISOString()}`);
      shiftEndTime.setUTCHours(parseInt(handoffHours), parseInt(handoffMinutes), 0, 0);
      console.log(`   After handoff: ${shiftEndTime.toISOString()}`);
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

      if (shiftIndex < 10) { // Log first 10 shifts for debugging
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

// Test data
const mockMembers = [
  { user_id: 'user-1', user_name: 'Alice' },
  { user_id: 'user-2', user_name: 'Bob' },
  { user_id: 'user-3', user_name: 'Charlie' }
];

const mockRotation = {
  id: 1,
  name: 'Test Rotation',
  shiftLength: 'one_week',
  handoffTime: '02:00',  // This is the key - handoff at 2 AM
  startDate: '2025-01-01',
  startTime: '09:00',
  hasEndDate: false,
  endDate: '',
  endTime: '23:59'
};

console.log('🧪 Testing Gap Fix in Schedule Transformer\n');

console.log('📅 Testing weekly rotation with 2 AM handoff time');
try {
  const shifts = generateRotationShifts(mockRotation, mockMembers, 5); // 5 weeks = 5 shifts
  
  console.log('\n🔍 Analyzing gaps between shifts:');
  for (let i = 0; i < shifts.length - 1; i++) {
    const currentShift = shifts[i];
    const nextShift = shifts[i + 1];
    
    const currentEnd = new Date(currentShift.end_time);
    const nextStart = new Date(nextShift.start_time);
    
    const gapMs = nextStart.getTime() - currentEnd.getTime();
    const gapHours = gapMs / (1000 * 60 * 60);
    
    const currentMember = mockMembers.find(m => m.user_id === currentShift.user_id);
    const nextMember = mockMembers.find(m => m.user_id === nextShift.user_id);
    
    console.log(`Gap between ${currentMember.user_name} and ${nextMember.user_name}: ${gapHours} hours`);
    
    if (gapHours > 0) {
      console.log(`⚠️  GAP DETECTED: ${gapHours} hours with no coverage!`);
    } else if (gapHours === 0) {
      console.log(`✅ Perfect handoff - no gap`);
    } else {
      console.log(`⚠️  OVERLAP DETECTED: ${Math.abs(gapHours)} hours overlap`);
    }
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\n🎉 Gap analysis completed!');
