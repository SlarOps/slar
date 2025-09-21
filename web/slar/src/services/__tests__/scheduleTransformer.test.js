/**
 * Tests for Schedule Transformer Service
 * Tests the yearly rotation generation functionality
 */

import {
  transformScheduleDataWithRotation,
  transformScheduleDataWithYearlyRotation,
  transformScheduleDataSingleShift,
  generateRotationShifts,
  getShiftDurationDays,
  calculateMemberTimes
} from '../scheduleTransformer';

describe('Schedule Transformer Service', () => {
  const mockMembers = [
    { user_id: 'user-1', user_name: 'Alice' },
    { user_id: 'user-2', user_name: 'Bob' },
    { user_id: 'user-3', user_name: 'Charlie' }
  ];

  const mockRotation = {
    id: 1,
    name: 'Test Rotation',
    shiftLength: 'one_week',
    handoffTime: '09:00',
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

  describe('getShiftDurationDays', () => {
    test('should return correct duration for different shift lengths', () => {
      expect(getShiftDurationDays('one_day')).toBe(1);
      expect(getShiftDurationDays('one_week')).toBe(7);
      expect(getShiftDurationDays('two_weeks')).toBe(14);
      expect(getShiftDurationDays('one_month')).toBe(30);
      expect(getShiftDurationDays('unknown')).toBe(7); // default
    });
  });

  describe('generateRotationShifts', () => {
    test('should generate correct number of shifts for 4 weeks', () => {
      const shifts = generateRotationShifts(mockRotation, mockMembers, 4);
      
      // 4 weeks = 28 days, with 7-day shifts = 4 shifts total
      expect(shifts).toHaveLength(4);
      
      // Check that members rotate correctly
      expect(shifts[0].user_id).toBe('user-1'); // Alice
      expect(shifts[1].user_id).toBe('user-2'); // Bob  
      expect(shifts[2].user_id).toBe('user-3'); // Charlie
      expect(shifts[3].user_id).toBe('user-1'); // Alice again
    });

    test('should generate shifts with correct timing', () => {
      const shifts = generateRotationShifts(mockRotation, mockMembers, 2);
      
      // First shift should start at rotation start time
      const firstShift = shifts[0];
      expect(firstShift.start_time).toBe('2025-01-01T09:00:00.000Z');
      expect(firstShift.end_time).toBe('2025-01-08T09:00:00.000Z');
      
      // Second shift should start when first ends
      const secondShift = shifts[1];
      expect(secondShift.start_time).toBe('2025-01-08T09:00:00.000Z');
      expect(secondShift.end_time).toBe('2025-01-15T09:00:00.000Z');
    });

    test('should handle daily rotations correctly', () => {
      const dailyRotation = {
        ...mockRotation,
        shiftLength: 'one_day'
      };
      
      const shifts = generateRotationShifts(dailyRotation, mockMembers, 1); // 1 week
      
      // 7 days with daily shifts = 7 shifts
      expect(shifts).toHaveLength(7);
      
      // Check rotation pattern
      expect(shifts[0].user_id).toBe('user-1'); // Day 1: Alice
      expect(shifts[1].user_id).toBe('user-2'); // Day 2: Bob
      expect(shifts[2].user_id).toBe('user-3'); // Day 3: Charlie
      expect(shifts[3].user_id).toBe('user-1'); // Day 4: Alice again
    });
  });

  describe('transformScheduleDataWithRotation', () => {
    test('should generate yearly shifts by default', () => {
      const shifts = transformScheduleDataWithRotation(mockScheduleData);
      
      // 52 weeks with 7-day shifts = 52 shifts total
      expect(shifts).toHaveLength(52);
      
      // Check that all shifts have required properties
      shifts.forEach(shift => {
        expect(shift).toHaveProperty('user_id');
        expect(shift).toHaveProperty('schedule_type', 'custom');
        expect(shift).toHaveProperty('start_time');
        expect(shift).toHaveProperty('end_time');
        expect(shift).toHaveProperty('is_recurring', false);
        expect(shift).toHaveProperty('rotation_days', 7);
      });
    });

    test('should generate single shift per member when yearly generation disabled', () => {
      const shifts = transformScheduleDataWithRotation(mockScheduleData, { 
        generateYearlyShifts: false 
      });
      
      // Should have one shift per member
      expect(shifts).toHaveLength(3);
      
      // Check that each member has one shift
      const userIds = shifts.map(s => s.user_id);
      expect(userIds).toContain('user-1');
      expect(userIds).toContain('user-2');
      expect(userIds).toContain('user-3');
    });

    test('should respect custom weeks ahead parameter', () => {
      const shifts = transformScheduleDataWithRotation(mockScheduleData, { 
        weeksAhead: 8 
      });
      
      // 8 weeks with 7-day shifts = 8 shifts total
      expect(shifts).toHaveLength(8);
    });

    test('should throw error for invalid schedule data', () => {
      expect(() => {
        transformScheduleDataWithRotation({});
      }).toThrow('Please select members and configure schedule details');

      expect(() => {
        transformScheduleDataWithRotation({ rotations: [], members: [] });
      }).toThrow('Please select members and configure schedule details');
    });
  });

  describe('convenience functions', () => {
    test('transformScheduleDataWithYearlyRotation should generate yearly shifts', () => {
      const shifts = transformScheduleDataWithYearlyRotation(mockScheduleData, 4);
      expect(shifts).toHaveLength(4); // 4 weeks = 4 shifts
    });

    test('transformScheduleDataSingleShift should generate single shift per member', () => {
      const shifts = transformScheduleDataSingleShift(mockScheduleData);
      expect(shifts).toHaveLength(3); // 3 members = 3 shifts
    });
  });

  describe('edge cases', () => {
    test('should handle rotation with end date', () => {
      const rotationWithEnd = {
        ...mockRotation,
        hasEndDate: true,
        endDate: '2025-01-07',
        endTime: '17:00'
      };

      const scheduleDataWithEnd = {
        ...mockScheduleData,
        rotations: [rotationWithEnd]
      };

      const shifts = transformScheduleDataWithRotation(scheduleDataWithEnd, { 
        generateYearlyShifts: false 
      });
      
      expect(shifts).toHaveLength(3);
    });

    test('should handle different handoff times', () => {
      const rotationWithHandoff = {
        ...mockRotation,
        handoffTime: '15:30'
      };

      const shifts = generateRotationShifts(rotationWithHandoff, mockMembers, 1);

      // Check that handoff time is applied to end time
      expect(shifts[0].end_time).toBe('2025-01-08T15:30:00.000Z');
    });

    test('should ensure continuous coverage with no gaps between shifts', () => {
      const rotationWithHandoff = {
        ...mockRotation,
        handoffTime: '02:00'  // 2 AM handoff time
      };

      const shifts = generateRotationShifts(rotationWithHandoff, mockMembers, 3); // 3 weeks = 3 shifts

      // Verify we have 3 shifts
      expect(shifts).toHaveLength(3);

      // Check that each shift starts exactly when the previous one ends (no gaps)
      for (let i = 0; i < shifts.length - 1; i++) {
        const currentShiftEnd = new Date(shifts[i].end_time);
        const nextShiftStart = new Date(shifts[i + 1].start_time);

        // Should be exactly the same time (no gap)
        expect(currentShiftEnd.getTime()).toBe(nextShiftStart.getTime());
      }

      // Verify specific times for the example scenario
      expect(shifts[0].start_time).toBe('2025-01-01T09:00:00.000Z'); // Alice starts at 9 AM
      expect(shifts[0].end_time).toBe('2025-01-08T02:00:00.000Z');   // Alice ends at 2 AM
      expect(shifts[1].start_time).toBe('2025-01-08T02:00:00.000Z'); // Bob starts at 2 AM (no gap)
      expect(shifts[1].end_time).toBe('2025-01-15T02:00:00.000Z');   // Bob ends at 2 AM
      expect(shifts[2].start_time).toBe('2025-01-15T02:00:00.000Z'); // Charlie starts at 2 AM (no gap)
    });
  });
});
