'use client';

import ScheduleManagement from './ScheduleManagement';

export default function SchedulerTab({ groupId, members }) {
  return (
    <ScheduleManagement groupId={groupId} members={members} />
  );
}
