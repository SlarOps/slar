'use client';

export default function IncidentSidebar({ incident }) {
    return (
        <div className="space-y-6">
            {/* Incident Details */}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Details</h3>

                <div className="space-y-3">
                    <div>
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Incident ID</dt>
                        <dd className="text-sm text-gray-900 dark:text-white font-mono">
                            {incident.id}
                        </dd>
                    </div>

                    {incident.incident_number && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Incident Number</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                #{incident.incident_number}
                            </dd>
                        </div>
                    )}

                    {incident.priority && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Priority</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                                    {incident.priority}
                                </span>
                            </dd>
                        </div>
                    )}

                    <div>
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created</dt>
                        <dd className="text-sm text-gray-900 dark:text-white">
                            {new Date(incident.created_at).toLocaleString()}
                        </dd>
                    </div>

                    {incident.acknowledged_at && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Acknowledged</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {new Date(incident.acknowledged_at).toLocaleString()}
                            </dd>
                        </div>
                    )}

                    {incident.resolved_at && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Resolved</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {new Date(incident.resolved_at).toLocaleString()}
                            </dd>
                        </div>
                    )}

                    {incident.assigned_to_name && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Assigned To</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {incident.assigned_to_name}
                            </dd>
                        </div>
                    )}

                    {incident.service_name && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Service</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {incident.service_name}
                            </dd>
                        </div>
                    )}

                    {incident.group_name && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Group</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {incident.group_name}
                            </dd>
                        </div>
                    )}



                    {/* Escalation Information */}
                    {incident.escalation_policy_name && (
                        <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Escalation Status</h4>

                            <div className="space-y-2">
                                <div>
                                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Escalation Progress</dt>
                                    <dd className="text-sm text-gray-900 dark:text-white">
                                        {incident.current_escalation_level === 0 ? (
                                            <span>Not escalated yet</span>
                                        ) : (
                                            <span>Escalated to Level {incident.current_escalation_level}</span>
                                        )}
                                        {incident.escalation_status && (
                                            <span className={`ml-2 px-2 py-1 text-xs font-medium rounded-full ${incident.escalation_status === 'escalating'
                                                    ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300'
                                                    : incident.escalation_status === 'completed'
                                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                                                        : incident.escalation_status === 'pending'
                                                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
                                                            : 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
                                                }`}>
                                                {incident.escalation_status}
                                            </span>
                                        )}
                                    </dd>
                                </div>

                                {incident.last_escalated_at && (
                                    <div>
                                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Last Escalated</dt>
                                        <dd className="text-sm text-gray-900 dark:text-white">
                                            {new Date(incident.last_escalated_at).toLocaleString()}
                                        </dd>
                                    </div>
                                )}

                                <div>
                                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Policy</dt>
                                    <dd className="text-sm text-gray-900 dark:text-white">
                                        {incident.escalation_policy_name}
                                    </dd>
                                </div>
                            </div>
                        </div>
                    )}

                    {incident.external_url && (
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">External Link</dt>
                            <dd className="text-sm">
                                <a
                                    href={incident.external_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                >
                                    View in source system →
                                </a>
                            </dd>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
