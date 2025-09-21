/**
 * Simple verification script to test the gap fix
 * This demonstrates the before/after behavior
 */

// Test data matching your original example
const mockMembers = [
  { user_id: 'user-1', user_name: 'Alice' },
  { user_id: 'user-2', user_name: 'Bob' },
  { user_id: 'user-3', user_name: 'Charlie' }
];

const mockRotation = {
  id: 1,
  name: 'Test Rotation',
  shiftLength: 'one_week',
  handoffTime: '02:00',  // 2 AM handoff
  startDate: '2025-01-01',
  startTime: '09:00',
  hasEndDate: false,
  endDate: '',
  endTime: '23:59'
};

// OLD LOGIC (with gaps)
const generateRotationShiftsOLD = (rotation, members, weeksAhead = 52) => {
  const backendSchedules = [];
  const shiftDurationDays = 7; // one_week
  const rotationStartDateTime = new Date(rotation.startDate + 'T' + rotation.startTime + ':00.000Z');
  const totalShifts = Math.ceil((weeksAhead * 7) / shiftDurationDays);

  for (let shiftIndex = 0; shiftIndex < totalShifts; shiftIndex++) {
    const memberIndex = shiftIndex % members.length;
    const member = members[memberIndex];

    // OLD: Calculate shift start time based on rotation start + index * duration
    const shiftStartTime = new Date(rotationStartDateTime);
    shiftStartTime.setDate(rotationStartDateTime.getDate() + (shiftIndex * shiftDurationDays));

    // Calculate shift end time
    const shiftEndTime = new Date(shiftStartTime);
    shiftEndTime.setDate(shiftStartTime.getDate() + shiftDurationDays);

    // Apply handoff time
    if (rotation.handoffTime) {
      const [handoffHours, handoffMinutes] = rotation.handoffTime.split(':');
      shiftEndTime.setUTCHours(parseInt(handoffHours), parseInt(handoffMinutes), 0, 0);
    }

    backendSchedules.push({
      user_id: member.user_id,
      start_time: shiftStartTime.toISOString(),
      end_time: shiftEndTime.toISOString()
    });
  }

  return backendSchedules;
};

// NEW LOGIC (continuous coverage)
const generateRotationShiftsNEW = (rotation, members, weeksAhead = 52) => {
  const backendSchedules = [];
  const shiftDurationDays = 7; // one_week
  const rotationStartDateTime = new Date(rotation.startDate + 'T' + rotation.startTime + ':00.000Z');
  const totalShifts = Math.ceil((weeksAhead * 7) / shiftDurationDays);
  
  let previousShiftEndTime = null;

  for (let shiftIndex = 0; shiftIndex < totalShifts; shiftIndex++) {
    const memberIndex = shiftIndex % members.length;
    const member = members[memberIndex];

    // NEW: Calculate shift start time based on previous shift end time
    let shiftStartTime;
    if (shiftIndex === 0) {
      shiftStartTime = new Date(rotationStartDateTime);
    } else {
      shiftStartTime = new Date(previousShiftEndTime);
    }

    // Calculate shift end time
    const shiftEndTime = new Date(shiftStartTime);
    shiftEndTime.setDate(shiftStartTime.getDate() + shiftDurationDays);

    // Apply handoff time
    if (rotation.handoffTime) {
      const [handoffHours, handoffMinutes] = rotation.handoffTime.split(':');
      shiftEndTime.setUTCHours(parseInt(handoffHours), parseInt(handoffMinutes), 0, 0);
    }

    backendSchedules.push({
      user_id: member.user_id,
      start_time: shiftStartTime.toISOString(),
      end_time: shiftEndTime.toISOString()
    });

    previousShiftEndTime = shiftEndTime;
  }

  return backendSchedules;
};

const analyzeGaps = (shifts, label) => {
  console.log(`\n📊 ${label}:`);
  
  for (let i = 0; i < Math.min(shifts.length, 5); i++) {
    const shift = shifts[i];
    const member = mockMembers.find(m => m.user_id === shift.user_id);
    console.log(`  Shift ${i + 1} - ${member.user_name}: ${shift.start_time} → ${shift.end_time}`);
  }
  
  console.log('\n🔍 Gap Analysis:');
  for (let i = 0; i < shifts.length - 1; i++) {
    const currentShift = shifts[i];
    const nextShift = shifts[i + 1];
    
    const currentEnd = new Date(currentShift.end_time);
    const nextStart = new Date(nextShift.start_time);
    
    const gapMs = nextStart.getTime() - currentEnd.getTime();
    const gapHours = gapMs / (1000 * 60 * 60);
    
    const currentMember = mockMembers.find(m => m.user_id === currentShift.user_id);
    const nextMember = mockMembers.find(m => m.user_id === nextShift.user_id);
    
    if (gapHours > 0) {
      console.log(`  ⚠️  GAP: ${gapHours} hours between ${currentMember.user_name} and ${nextMember.user_name}`);
    } else if (gapHours === 0) {
      console.log(`  ✅ Perfect handoff: ${currentMember.user_name} → ${nextMember.user_name}`);
    } else {
      console.log(`  ⚠️  OVERLAP: ${Math.abs(gapHours)} hours between ${currentMember.user_name} and ${nextMember.user_name}`);
    }
  }
};

console.log('🧪 Comparing OLD vs NEW Schedule Generation Logic\n');

// Test with 5 weeks (5 shifts)
const oldShifts = generateRotationShiftsOLD(mockRotation, mockMembers, 5);
const newShifts = generateRotationShiftsNEW(mockRotation, mockMembers, 5);

analyzeGaps(oldShifts, 'OLD Logic (with gaps)');
analyzeGaps(newShifts, 'NEW Logic (continuous coverage)');

console.log('\n🎉 Verification completed!');
console.log('\nThe NEW logic ensures continuous coverage with no gaps between shifts.');
console.log('Each shift starts exactly when the previous shift ends at the handoff time.');
