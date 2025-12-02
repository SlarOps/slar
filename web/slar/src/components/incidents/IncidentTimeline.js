'use client';

export default function IncidentTimeline({ events }) {
    const getEventIcon = (eventType) => {
        switch (eventType) {
            case 'triggered':
                return (
                    <div className="w-8 h-8 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                    </div>
                );
            case 'acknowledged':
                return (
                    <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/20 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                );
            case 'resolved':
                return (
                    <div className="w-8 h-8 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                );
            case 'assigned':
            case 'escalated':
                return (
                    <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                    </div>
                );
            case 'escalation_completed':
                return (
                    <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/20 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                );
            default:
                return (
                    <div className="w-8 h-8 bg-gray-100 dark:bg-gray-900/20 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-gray-600 dark:text-gray-400 rounded-full"></div>
                    </div>
                );
        }
    };

    const formatEventDescription = (event) => {
        const eventType = event.event_type;
        const eventData = event.event_data || {};

        switch (eventType) {
            case 'triggered':
                return `Incident triggered from ${eventData.source || 'unknown source'}`;
            case 'acknowledged':
                return `Incident acknowledged${event.created_by_name ? ` by ${event.created_by_name}` : ''}`;
            case 'resolved':
                return `Incident resolved${event.created_by_name ? ` by ${event.created_by_name}` : ''}`;
            case 'assigned':
                if (eventData.method === 'escalation_policy') {
                    return `Auto-assigned via escalation policy${eventData.assigned_to ? ` to user` : ''}`;
                }
                return `Manually assigned${event.created_by_name ? ` by ${event.created_by_name}` : ''}`;
            case 'escalated':
                const level = eventData.escalation_level || eventData.level;
                const targetType = eventData.target_type;
                const targetName = eventData.target_name || eventData.assigned_to;
                const reason = eventData.reason;

                // Check if manual or automatic escalation
                const isManual = reason === 'manual_escalation';
                let description = isManual 
                    ? `Manually escalated to level ${level}`
                    : `Auto-escalated to policy level ${level}`;

                if (targetType === 'scheduler') {
                    description += ` (on-call scheduler)`;
                } else if (targetType === 'user') {
                    description += ` (direct user)`;
                } else if (targetType === 'group') {
                    description += ` (group)`;
                } else if (targetType === 'current_schedule') {
                    description += ` (current schedule)`;
                }

                if (targetName) {
                    description += ` → ${targetName}`;
                }

                // Add who performed the escalation for manual cases
                if (isManual && event.created_by_name) {
                    description += ` by ${event.created_by_name}`;
                }

                return description;
            case 'escalation_completed':
                const finalLevel = eventData.final_level;
                const finalAssignee = eventData.final_assignee;

                let completedDescription = `Escalation completed`;
                if (finalLevel) {
                    completedDescription += ` at level ${finalLevel}`;
                }
                if (finalAssignee) {
                    completedDescription += ` → Final assignee: ${finalAssignee}`;
                }

                return completedDescription;
            default:
                return eventType.replace('_', ' ').toLowerCase();
        }
    };

    return (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Timeline & Escalation History
            </h3>

            {events.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">No events recorded yet.</p>
            ) : (
                <div className="flow-root">
                    <ul className="-mb-8">
                        {events.map((event, index) => (
                            <li key={event.id || index}>
                                <div className="relative pb-8">
                                    {index !== events.length - 1 && (
                                        <span
                                            className="absolute top-8 left-4 -ml-px h-full w-0.5 bg-gray-200 dark:bg-gray-600"
                                            aria-hidden="true"
                                        />
                                    )}
                                    <div className="relative flex space-x-3">
                                        <div className="flex-shrink-0">
                                            {getEventIcon(event.event_type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                                                        {formatEventDescription(event)}
                                                    </p>
                                                    <div className="flex items-center space-x-2 mt-1">
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                                            {new Date(event.created_at).toLocaleString()}
                                                        </span>
                                                        {event.event_type === 'escalated' && event.event_data?.escalation_level && (
                                                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
                                                                Level {event.event_data.escalation_level}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Additional event details */}
                                            <div className="mt-2 space-y-1">
                                                {event.event_data?.assigned_to && (
                                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                                        <span className="font-medium">Assigned to:</span> {event.event_data.assigned_to}
                                                    </p>
                                                )}

                                                {event.event_data?.escalation_policy && (
                                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                                        <span className="font-medium">Policy:</span> {event.event_data.escalation_policy}
                                                    </p>
                                                )}

                                                {event.event_data?.target_type && (
                                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                                        <span className="font-medium">Target:</span> {event.event_data.target_type}
                                                        {event.event_data.target_name && ` (${event.event_data.target_name})`}
                                                    </p>
                                                )}

                                                {event.event_data?.note && (
                                                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 p-2 bg-gray-100 dark:bg-gray-700 rounded">
                                                        {event.event_data.note}
                                                    </p>
                                                )}

                                                {event.event_data?.reason && (
                                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                                        <span className="font-medium">Reason:</span> {event.event_data.reason}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
