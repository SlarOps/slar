'use client';

import React, { useState, useEffect } from 'react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Color scheme for different members
const MEMBER_COLORS = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
  'bg-pink-500', 'bg-indigo-500', 'bg-teal-500', 'bg-red-500'
];

function CalendarDay({ date, schedules, members, onDayClick, isInDayView = false }) {
  const isToday = new Date().toDateString() === date.toDateString();
  const daySchedules = schedules.filter(schedule => {
    const scheduleStart = new Date(schedule.start_time);
    const scheduleEnd = new Date(schedule.end_time);
    return date >= scheduleStart && date <= scheduleEnd;
  });

  const getMemberColor = (userId) => {
    const memberIndex = members.findIndex(m => m.user_id === userId);
    return MEMBER_COLORS[memberIndex % MEMBER_COLORS.length];
  };

  // Enhanced styling for day view
  const containerClass = isInDayView 
    ? `min-h-96 p-6 border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
        isToday ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' : 'bg-white dark:bg-gray-900'
      }`
    : `min-h-20 p-1 border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
        isToday ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' : 'bg-white dark:bg-gray-900'
      }`;

  const dayNumberClass = isInDayView
    ? `text-2xl font-bold mb-4 ${
        isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'
      }`
    : `text-xs font-medium mb-1 ${
        isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'
      }`;

  const maxSchedulesToShow = isInDayView ? daySchedules.length : 3;

  return (
    <div className={containerClass} onClick={() => onDayClick(date, daySchedules)}>
      {/* Day number */}
      <div className={dayNumberClass}>
        {isInDayView ? `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}` : date.getDate()}
      </div>

      {/* Schedule indicators */}
      <div className={isInDayView ? "space-y-3" : "space-y-1"}>
        {daySchedules.slice(0, maxSchedulesToShow).map((schedule) => {
          const member = members.find(m => m.user_id === schedule.user_id);
          const colorClass = getMemberColor(schedule.user_id);
          
          return (
            <div
              key={schedule.id}
              className={`${
                isInDayView 
                  ? 'px-3 py-2 rounded-lg text-sm text-white font-medium'
                  : 'px-1 py-0.5 rounded text-xs text-white font-medium truncate'
              } ${colorClass}`}
              title={`${member?.user_name || 'Unknown'} - ${schedule.schedule_type}`}
            >
              {isInDayView 
                ? `${member?.user_name || 'Unknown'} - ${schedule.schedule_type}`
                : member?.user_name?.split(' ')[0] || 'Unknown'
              }
            </div>
          );
        })}
        
        {!isInDayView && daySchedules.length > 3 && (
          <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
            +{daySchedules.length - 3} more
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleDetailModal({ isOpen, onClose, date, schedules, members }) {
  if (!isOpen) return null;

  const getMemberColor = (userId) => {
    const memberIndex = members.findIndex(m => m.user_id === userId);
    return MEMBER_COLORS[memberIndex % MEMBER_COLORS.length];
  };

  return (
    <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-96 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              📅 {date?.toISOString().split('T')[0]}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {schedules.length} schedule{schedules.length !== 1 ? 's' : ''} on this day
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-80">
          {schedules.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-400 dark:text-gray-500 text-sm">
                No schedules on this day
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => {
                const member = members.find(m => m.user_id === schedule.user_id);
                const colorClass = getMemberColor(schedule.user_id);
                const startTime = new Date(schedule.start_time);
                const endTime = new Date(schedule.end_time);
                
                return (
                  <div key={schedule.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    {/* Member info */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-3 h-3 rounded-full ${colorClass}`}></div>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {member?.user_name || 'Unknown Member'}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        ({member?.user_email})
                      </span>
                    </div>
                    
                    {/* Schedule details */}
                    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-500">🎯</span>
                        <span className="capitalize">{schedule.schedule_type} Schedule</span>
                        {schedule.is_overridden && (
                          <span className="text-amber-500 text-xs">🔄 Override</span>
                        )}
                        {schedule.rotation_cycle_id && (
                          <span className="text-blue-500 text-xs">🔁 Auto</span>
                        )}
                        {schedule.is_recurring && !schedule.rotation_cycle_id && (
                          <span className="text-blue-500 text-xs">🔄 Recurring</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">🕐</span>
                        <span>
                          {startTime.toISOString().split('T')[1].slice(0, 5)} UTC
                          {' → '}
                          {endTime.toISOString().split('T')[1].slice(0, 5)} UTC
                        </span>
                      </div>
                      {schedule.is_overridden && (
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500">🔄</span>
                          <span className="text-amber-600 dark:text-amber-400">
                            Override: {schedule.original_user_name} → {schedule.user_name}
                          </span>
                        </div>
                      )}
                      {schedule.override_reason && (
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500">📝</span>
                          <span className="text-amber-600 dark:text-amber-400 text-xs">
                            {schedule.override_reason}
                          </span>
                        </div>
                      )}
                      {schedule.rotation_days > 1 && !schedule.is_overridden && (
                        <div className="flex items-center gap-2">
                          <span className="text-orange-500">🔄</span>
                          <span>Every {schedule.rotation_days} days</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScheduleTimelineCalendar({ schedules, members }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSchedules, setSelectedSchedules] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [viewMode, setViewMode] = useState('month'); // 'day', 'week', '2-week', 'month'

  // Generate calendar days based on view mode
  const generateCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const date = currentDate.getDate();
    
    switch (viewMode) {
      case 'day': {
        // Single day view
        return [new Date(year, month, date)];
      }
      
      case 'week': {
        // Week view - start from Sunday
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(date - currentDate.getDay());
        
        const days = [];
        for (let i = 0; i < 7; i++) {
          const day = new Date(startOfWeek);
          day.setDate(startOfWeek.getDate() + i);
          days.push(day);
        }
        return days;
      }
      
      case '2-week': {
        // 2-week view - start from Sunday of current week
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(date - currentDate.getDay());
        
        const days = [];
        for (let i = 0; i < 14; i++) {
          const day = new Date(startOfWeek);
          day.setDate(startOfWeek.getDate() + i);
          days.push(day);
        }
        return days;
      }
      
      case 'month':
      default: {
        // Month view - original logic
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        // Start from the beginning of the week containing the first day
        const startDate = new Date(firstDay);
        startDate.setDate(firstDay.getDate() - firstDay.getDay());
        
        // End at the end of the week containing the last day
        const endDate = new Date(lastDay);
        endDate.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
        
        const days = [];
        const current = new Date(startDate);
        
        while (current <= endDate) {
          days.push(new Date(current));
          current.setDate(current.getDate() + 1);
        }
        
        return days;
      }
    }
  };

  const goToPrevious = () => {
    const newDate = new Date(currentDate);
    
    switch (viewMode) {
      case 'day':
        newDate.setDate(currentDate.getDate() - 1);
        break;
      case 'week':
        newDate.setDate(currentDate.getDate() - 7);
        break;
      case '2-week':
        newDate.setDate(currentDate.getDate() - 14);
        break;
      case 'month':
      default:
        newDate.setMonth(currentDate.getMonth() - 1);
        break;
    }
    
    setCurrentDate(newDate);
  };

  const goToNext = () => {
    const newDate = new Date(currentDate);
    
    switch (viewMode) {
      case 'day':
        newDate.setDate(currentDate.getDate() + 1);
        break;
      case 'week':
        newDate.setDate(currentDate.getDate() + 7);
        break;
      case '2-week':
        newDate.setDate(currentDate.getDate() + 14);
        break;
      case 'month':
      default:
        newDate.setMonth(currentDate.getMonth() + 1);
        break;
    }
    
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getDateRangeLabel = () => {
    const year = currentDate.getFullYear();
    const month = MONTHS[currentDate.getMonth()];
    
    switch (viewMode) {
      case 'day': {
        const date = currentDate.getDate();
        return `${month} ${date}, ${year}`;
      }
      
      case 'week': {
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        
        const startMonth = MONTHS[startOfWeek.getMonth()];
        const endMonth = MONTHS[endOfWeek.getMonth()];
        const startYear = startOfWeek.getFullYear();
        const endYear = endOfWeek.getFullYear();
        
        if (startMonth === endMonth && startYear === endYear) {
          return `${startMonth} ${startOfWeek.getDate()}-${endOfWeek.getDate()}, ${startYear}`;
        } else if (startYear === endYear) {
          return `${startMonth} ${startOfWeek.getDate()} - ${endMonth} ${endOfWeek.getDate()}, ${startYear}`;
        } else {
          return `${startMonth} ${startOfWeek.getDate()}, ${startYear} - ${endMonth} ${endOfWeek.getDate()}, ${endYear}`;
        }
      }
      
      case '2-week': {
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOf2Week = new Date(startOfWeek);
        endOf2Week.setDate(startOfWeek.getDate() + 13);
        
        const startMonth = MONTHS[startOfWeek.getMonth()];
        const endMonth = MONTHS[endOf2Week.getMonth()];
        const startYear = startOfWeek.getFullYear();
        const endYear = endOf2Week.getFullYear();
        
        if (startMonth === endMonth && startYear === endYear) {
          return `${startMonth} ${startOfWeek.getDate()}-${endOf2Week.getDate()}, ${startYear}`;
        } else if (startYear === endYear) {
          return `${startMonth} ${startOfWeek.getDate()} - ${endMonth} ${endOf2Week.getDate()}, ${startYear}`;
        } else {
          return `${startMonth} ${startOfWeek.getDate()}, ${startYear} - ${endMonth} ${endOf2Week.getDate()}, ${endYear}`;
        }
      }
      
      case 'month':
      default:
        return `${month} ${year}`;
    }
  };

  const handleDayClick = (date, daySchedules) => {
    setSelectedDate(date);
    setSelectedSchedules(daySchedules);
    setShowModal(true);
  };

  const getCalendarLayout = () => {
    const calendarDays = generateCalendarDays();
    
    switch (viewMode) {
      case 'day': {
        // Single day view - larger format
        const date = calendarDays[0];
        return (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <CalendarDay
              date={date}
              schedules={schedules}
              members={members}
              onDayClick={handleDayClick}
              isInDayView={true}
            />
          </div>
        );
      }
      
      case 'week': {
        // Week view - 7 columns
        return (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-0 mb-2">
              {WEEKDAYS.map((day) => (
                <div 
                  key={day} 
                  className="p-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400"
                >
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              {calendarDays.map((date, index) => (
                <CalendarDay
                  key={index}
                  date={date}
                  schedules={schedules}
                  members={members}
                  onDayClick={handleDayClick}
                />
              ))}
            </div>
          </>
        );
      }
      
      case '2-week': {
        // 2-week view - 7 columns, 2 rows
        return (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-0 mb-2">
              {WEEKDAYS.map((day) => (
                <div 
                  key={day} 
                  className="p-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400"
                >
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar days - first week */}
            <div className="grid grid-cols-7 gap-0 border border-gray-200 dark:border-gray-700 rounded-t-lg overflow-hidden">
              {calendarDays.slice(0, 7).map((date, index) => (
                <CalendarDay
                  key={index}
                  date={date}
                  schedules={schedules}
                  members={members}
                  onDayClick={handleDayClick}
                />
              ))}
            </div>
            
            {/* Calendar days - second week */}
            <div className="grid grid-cols-7 gap-0 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-lg overflow-hidden">
              {calendarDays.slice(7, 14).map((date, index) => (
                <CalendarDay
                  key={index + 7}
                  date={date}
                  schedules={schedules}
                  members={members}
                  onDayClick={handleDayClick}
                />
              ))}
            </div>
          </>
        );
      }
      
      case 'month':
      default: {
        // Month view - original grid layout
        return (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-0 mb-2">
              {WEEKDAYS.map((day) => (
                <div 
                  key={day} 
                  className="p-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400"
                >
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              {calendarDays.map((date, index) => {
                const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                
                return (
                  <div
                    key={index}
                    className={`${!isCurrentMonth ? 'opacity-30' : ''}`}
                  >
                    <CalendarDay
                      date={date}
                      schedules={schedules}
                      members={members}
                      onDayClick={handleDayClick}
                    />
                  </div>
                );
              })}
            </div>
          </>
        );
      }
    }
  };

  const calendarDays = generateCalendarDays();
  const currentMonth = MONTHS[currentDate.getMonth()];
  const currentYear = currentDate.getFullYear();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Calendar Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            📅 Schedule Timeline
          </h3>
          
          {/* Navigation controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={goToToday}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Today
            </button>
            
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevious}
                className="p-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              <span className="text-lg font-semibold text-gray-900 dark:text-white min-w-36 text-center">
                {getDateRangeLabel()}
              </span>
              
              <button
                onClick={goToNext}
                className="p-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* View Mode Selector */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">View:</span>
          {[
            { value: 'day', label: 'Day', icon: '📅' },
            { value: 'week', label: 'Week', icon: '📆' },
            { value: '2-week', label: '2 Weeks', icon: '🗓️' },
            { value: 'month', label: 'Month', icon: '📋' }
          ].map((mode) => (
            <button
              key={mode.value}
              onClick={() => setViewMode(mode.value)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                viewMode === mode.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <span className="text-xs">{mode.icon}</span>
              {mode.label}
            </button>
          ))}
        </div>

        {/* Member legend */}
        {members.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {members.map((member, index) => {
              const colorClass = MEMBER_COLORS[index % MEMBER_COLORS.length];
              return (
                <div key={member.user_id} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${colorClass}`}></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {member.user_name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Calendar Grid */}
      <div className="p-4">
        {getCalendarLayout()}
      </div>

      {/* Schedule detail modal */}
      <ScheduleDetailModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        date={selectedDate}
        schedules={selectedSchedules}
        members={members}
      />
    </div>
  );
}
