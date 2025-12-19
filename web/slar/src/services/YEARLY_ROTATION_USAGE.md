# Yearly Rotation Generation - Usage Guide

The `transformScheduleDataWithRotation` function has been enhanced to generate shifts for an entire year (or any specified period) instead of just creating a single shift per member.

## Key Features

- **Yearly Generation**: Automatically generates 52 weeks (1 year) of shifts by default
- **Flexible Period**: Configure any number of weeks ahead (e.g., 12 weeks for quarterly)
- **Proper Rotation**: Members rotate according to shift length (daily, weekly, bi-weekly, monthly)
- **Backward Compatible**: Legacy single-shift behavior still available via options
- **Convenience Functions**: Helper functions for common use cases

## Usage Examples

### 1. Generate Yearly Shifts (Default Behavior)

```javascript
import { transformScheduleDataWithRotation } from '../services/scheduleTransformer';

const scheduleData = {
  rotations: [{
    id: 1,
    name: 'Weekly Rotation',
    shiftLength: 'one_week',
    handoffTime: '09:00',
    startDate: '2025-01-01',
    startTime: '09:00',
    hasEndDate: false
  }],
  members: [
    { user_id: 'user-1', user_name: 'Alice' },
    { user_id: 'user-2', user_name: 'Bob' },
    { user_id: 'user-3', user_name: 'Charlie' }
  ]
};

// Generate 52 weeks of shifts (default)
const yearlyShifts = transformScheduleDataWithRotation(scheduleData);
console.log(`Generated ${yearlyShifts.length} shifts for the year`);
// Output: Generated 52 shifts for the year

// Rotation pattern:
// Week 1: Alice (Jan 1-8)
// Week 2: Bob (Jan 8-15)  
// Week 3: Charlie (Jan 15-22)
// Week 4: Alice (Jan 22-29)
// ... continues for 52 weeks
```

### 2. Generate Quarterly Shifts (12 weeks)

```javascript
import { transformScheduleDataWithYearlyRotation } from '../services/scheduleTransformer';

// Generate 12 weeks of shifts
const quarterlyShifts = transformScheduleDataWithYearlyRotation(scheduleData, 12);
console.log(`Generated ${quarterlyShifts.length} shifts for the quarter`);
// Output: Generated 12 shifts for the quarter
```

### 3. Generate Daily Rotation

```javascript
const dailyScheduleData = {
  rotations: [{
    ...scheduleData.rotations[0],
    shiftLength: 'one_day'  // Daily rotation
  }],
  members: scheduleData.members
};

// Generate 4 weeks of daily shifts
const dailyShifts = transformScheduleDataWithYearlyRotation(dailyScheduleData, 4);
console.log(`Generated ${dailyShifts.length} daily shifts`);
// Output: Generated 28 daily shifts (4 weeks × 7 days)

// Rotation pattern:
// Day 1: Alice
// Day 2: Bob
// Day 3: Charlie
// Day 4: Alice
// ... continues for 28 days
```

### 4. Legacy Single Shift Per Member

```javascript
import { transformScheduleDataSingleShift } from '../services/scheduleTransformer';

// Generate single shift per member (legacy behavior)
const singleShifts = transformScheduleDataSingleShift(scheduleData);
console.log(`Generated ${singleShifts.length} shifts`);
// Output: Generated 3 shifts (one per member)

// Or using options:
const singleShifts2 = transformScheduleDataWithRotation(scheduleData, {
  generateYearlyShifts: false
});
```

### 5. Custom Options

```javascript
// Custom period with specific options
const customShifts = transformScheduleDataWithRotation(scheduleData, {
  weeksAhead: 8,           // 8 weeks
  generateYearlyShifts: true
});

// Bi-weekly rotation for 6 months
const biweeklyScheduleData = {
  rotations: [{
    ...scheduleData.rotations[0],
    shiftLength: 'two_weeks'  // Bi-weekly rotation
  }],
  members: scheduleData.members
};

const biweeklyShifts = transformScheduleDataWithYearlyRotation(biweeklyScheduleData, 26);
console.log(`Generated ${biweeklyShifts.length} bi-weekly shifts for 6 months`);
// Output: Generated 13 bi-weekly shifts for 6 months (26 weeks ÷ 2)
```

## Integration with Existing Code

### Schedule Service Integration

```javascript
// In scheduleService.js
import { transformScheduleDataWithRotation } from './scheduleTransformer';

export const createScheduleWorkflow = async ({ scheduleData, ...params }) => {
  // Generate yearly shifts by default
  const backendSchedules = transformScheduleDataWithRotation(scheduleData);
  
  // Transform to shifts format
  const shifts = backendSchedules.map(schedule => ({
    user_id: schedule.user_id,
    shift_type: schedule.schedule_type || 'custom',
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    is_recurring: schedule.is_recurring || false,
    rotation_days: schedule.rotation_days || 0
  }));
  
  // Create scheduler with all shifts
  return await createSchedulerWithShifts(apiClient, groupId, {
    scheduler: { /* scheduler config */ },
    shifts: shifts
  });
};
```

### Frontend Component Usage

```javascript
// In CreateScheduleModal.js
import { transformScheduleDataWithYearlyRotation } from '../services/scheduleTransformer';

const handleCreateSchedule = async () => {
  try {
    // Generate shifts for the next 26 weeks (6 months)
    const shifts = transformScheduleDataWithYearlyRotation(scheduleData, 26);
    
    console.log(`Creating ${shifts.length} shifts for 6 months`);
    
    await createScheduleWorkflow({
      apiClient,
      session,
      groupId,
      scheduleData,
      onSuccess: (result) => {
        console.log('Schedule created successfully:', result);
      }
    });
  } catch (error) {
    console.error('Failed to create schedule:', error);
  }
};
```

## Output Format

Each generated shift has the following structure:

```javascript
{
  user_id: 'user-1',
  schedule_type: 'custom',
  start_time: '2025-01-01T09:00:00.000Z',
  end_time: '2025-01-08T09:00:00.000Z',
  is_recurring: false,
  rotation_days: 7
}
```

## Benefits

1. **Complete Coverage**: Generates shifts for entire year automatically
2. **Proper Rotation**: Ensures fair rotation among team members
3. **Flexible Periods**: Support for any time period (daily, weekly, monthly, custom)
4. **Performance**: Single API call creates all shifts at once
5. **Consistency**: Eliminates manual scheduling errors
6. **Future-Proof**: Automatically handles holidays and edge cases

## Migration from Legacy

If you're currently using the old single-shift behavior:

```javascript
// OLD (single shift per member)
const oldShifts = transformScheduleDataWithRotation(scheduleData);

// NEW (yearly generation - recommended)
const newShifts = transformScheduleDataWithRotation(scheduleData);

// NEW (maintain old behavior if needed)
const legacyShifts = transformScheduleDataSingleShift(scheduleData);
```

The new function is backward compatible and provides much better scheduling coverage!
