// Schedule-related constants used across components

export const SHIFT_LENGTHS = [
  { value: 'one_day', label: 'One Day' },
  { value: 'one_week', label: 'One Week' },
  { value: 'two_weeks', label: 'Two Weeks' },
  { value: 'one_month', label: 'One Month' }
];

export const HANDOFF_DAYS = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' }
];

export const DEFAULT_ROTATION = {
  id: 1,
  name: 'Rotation 1',
  shiftLength: 'one_week',
  handoffDay: 'friday',
  handoffTime: '16:00',
  startDate: new Date().toISOString().split('T')[0],
  startTime: '09:00',
  hasEndDate: false,
  endDate: '',
  endTime: '23:59'
};
