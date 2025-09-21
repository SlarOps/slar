/**
 * Demo script to test the updated transformScheduleDataWithRotation function
 * Run this with: node demo-schedule-transformer.js
 */

import {
  transformScheduleDataWithRotation,
  transformScheduleDataWithYearlyRotation,
  transformScheduleDataSingleShift,
  generateRotationShifts
} from './scheduleTransformer.js';

// Mock data for testing
const mockMembers = [
  { user_id: 'user-1', user_name: 'Alice' },
  { user_id: 'user-2', user_name: 'Bob' },
  { user_id: 'user-3', user_name: 'Charlie' }
];

const mockRotation = {
  id: 1,
  name: 'Test Rotation',
  shiftLength: 'one_week',
  handoffTime: '02:00',  // 2 AM handoff time (matches your example)
  startDate: '2025-01-01',
  startTime: '09:00',
  hasEndDate: false,
  endDate: '',
  endTime: '23:59'
};

const mockScheduleData = {
  rotations: [mockRotation],
  members: mockMembers,
  schedulerName: 'test-scheduler',
  schedulerDisplayName: 'Test Scheduler'
};

console.log('🧪 Testing Schedule Transformer Functions\n');

// Test 1: Generate yearly shifts (default behavior)
console.log('📅 Test 1: Yearly rotation generation (52 weeks)');
try {
  const yearlyShifts = transformScheduleDataWithRotation(mockScheduleData);
  console.log(`✅ Generated ${yearlyShifts.length} shifts for the year`);
  
  // Show first 3 shifts
  console.log('First 3 shifts:');
  yearlyShifts.slice(0, 3).forEach((shift, index) => {
    const member = mockMembers.find(m => m.user_id === shift.user_id);
    console.log(`  ${index + 1}. ${member.user_name}: ${shift.start_time} → ${shift.end_time}`);
  });
  console.log('');
} catch (error) {
  console.error('❌ Error:', error.message);
}

// Test 2: Generate quarterly shifts (12 weeks)
console.log('📅 Test 2: Quarterly rotation generation (12 weeks)');
try {
  const quarterlyShifts = transformScheduleDataWithYearlyRotation(mockScheduleData, 12);
  console.log(`✅ Generated ${quarterlyShifts.length} shifts for 12 weeks`);
  
  // Show all shifts for quarterly
  console.log('All quarterly shifts:');
  quarterlyShifts.forEach((shift, index) => {
    const member = mockMembers.find(m => m.user_id === shift.user_id);
    const startDate = new Date(shift.start_time).toLocaleDateString();
    const endDate = new Date(shift.end_time).toLocaleDateString();
    console.log(`  ${index + 1}. ${member.user_name}: ${startDate} → ${endDate}`);
  });
  console.log('');
} catch (error) {
  console.error('❌ Error:', error.message);
}

// Test 3: Generate single shift per member (legacy behavior)
console.log('📅 Test 3: Single shift per member (legacy)');
try {
  const singleShifts = transformScheduleDataSingleShift(mockScheduleData);
  console.log(`✅ Generated ${singleShifts.length} shifts (one per member)`);
  
  // Show all single shifts
  console.log('Single shifts:');
  singleShifts.forEach((shift, index) => {
    const member = mockMembers.find(m => m.user_id === shift.user_id);
    console.log(`  ${index + 1}. ${member.user_name}: ${shift.start_time} → ${shift.end_time}`);
  });
  console.log('');
} catch (error) {
  console.error('❌ Error:', error.message);
}

// Test 4: Daily rotation for 1 week
console.log('📅 Test 4: Daily rotation for 1 week');
try {
  const dailyRotation = {
    ...mockRotation,
    shiftLength: 'one_day'
  };
  
  const dailyShifts = generateRotationShifts(dailyRotation, mockMembers, 1);
  console.log(`✅ Generated ${dailyShifts.length} daily shifts for 1 week`);
  
  // Show all daily shifts
  console.log('Daily shifts:');
  dailyShifts.forEach((shift, index) => {
    const member = mockMembers.find(m => m.user_id === shift.user_id);
    const startDate = new Date(shift.start_time).toLocaleDateString();
    console.log(`  Day ${index + 1}: ${member.user_name} (${startDate})`);
  });
  console.log('');
} catch (error) {
  console.error('❌ Error:', error.message);
}

// Test 5: Custom options
console.log('📅 Test 5: Custom options (4 weeks, yearly generation)');
try {
  const customShifts = transformScheduleDataWithRotation(mockScheduleData, {
    weeksAhead: 4,
    generateYearlyShifts: true
  });
  console.log(`✅ Generated ${customShifts.length} shifts for 4 weeks`);
  
  // Show rotation pattern
  console.log('Rotation pattern:');
  customShifts.forEach((shift, index) => {
    const member = mockMembers.find(m => m.user_id === shift.user_id);
    const startDate = new Date(shift.start_time).toLocaleDateString();
    console.log(`  Week ${index + 1}: ${member.user_name} (starts ${startDate})`);
  });
  console.log('');
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('🎉 All tests completed!');
