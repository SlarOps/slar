'use client';

import { Button } from '@headlessui/react';
import { useRouter } from 'next/navigation';

export default function IncidentHeader({
    incident,
    loading,
    actionLoading,
    onAction,
    error
}) {
    const router = useRouter();

    const getStatusColor = (status) => {
        switch (status) {
            case 'triggered':
                return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
            case 'acknowledged':
                return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300';
            case 'resolved':
                return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
            default:
                return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
        }
    };

    const getUrgencyColor = (urgency) => {
        return urgency === 'high'
            ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
    };

    return (
        <div className="flex flex-col space-y-4">
            <div className="flex-1">
                {loading ? (
                    <div className="animate-pulse">
                        <div className="h-6 md:h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4"></div>
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    </div>
                ) : incident ? (
                    <>
                        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white mb-1">
                            {incident.title}
                        </h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                            Incident #{incident.id.slice(-8)}
                        </p>

                        <div className="flex items-center gap-2 flex-wrap mb-3 md:mb-4">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(incident.status)}`}>
                                {incident.status.toUpperCase()}
                            </span>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getUrgencyColor(incident.urgency)}`}>
                                {incident.urgency.toUpperCase()} URGENCY
                            </span>
                            {incident.severity && (
                                <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300">
                                    {incident.severity.toUpperCase()}
                                </span>
                            )}
                        </div>
                    </>
                ) : (
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
                        Incident Details
                    </h1>
                )}
            </div>

            {/* Action Buttons */}
            {incident && (
                <div className="flex flex-col sm:flex-row gap-2">
                    {/* Ask AI Agent Button */}
                    <Button
                        onClick={() => {
                            router.push(`/ai-agent?incident=${incident.id}`);
                        }}
                        className="relative group px-6 py-2.5 rounded-full text-sm font-semibold text-white transition-all duration-300 hover:shadow-xl hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2"
                        style={{
                            background: 'linear-gradient(135deg, #ee9ca7 0%, #c084fc 50%, #60a5fa 100%)',
                        }}
                    >
                        <div className="flex items-center justify-center space-x-2">
                            {/* Atom Icon */}
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <circle cx="12" cy="12" r="1" fill="currentColor" />
                                <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
                                <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-60 12 12)" />
                                <ellipse cx="12" cy="12" rx="10" ry="4" />
                            </svg>
                            <span>Ask AI</span>
                        </div>
                    </Button>

                    <div className="flex gap-2">
                        {incident.status === 'triggered' && (
                            <Button
                                onClick={() => onAction('acknowledge')}
                                disabled={actionLoading}
                                className="flex-1 sm:flex-none bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            >
                                {actionLoading ? 'Processing...' : 'Acknowledge'}
                            </Button>
                        )}

                        {incident.status !== 'resolved' && (
                            <Button
                                onClick={() => onAction('resolve')}
                                disabled={actionLoading}
                                className="flex-1 sm:flex-none bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                            >
                                {actionLoading ? 'Processing...' : 'Resolve'}
                            </Button>
                        )}

                        {/* Escalate button - show only when incident has escalation policy and can be escalated */}
                        {incident.status !== 'resolved' && incident.escalation_policy_id && (
                            <Button
                                onClick={() => onAction('escalate')}
                                disabled={actionLoading || incident.escalation_status === 'completed'}
                                className={`flex-1 sm:flex-none ${incident.escalation_status === 'completed'
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-orange-500 hover:bg-orange-600'
                                    } disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2`}
                                title={incident.escalation_status === 'completed'
                                    ? 'Already at maximum escalation level'
                                    : `Escalate to level ${(incident.current_escalation_level || 0) + 1}`}
                            >
                                {actionLoading ? 'Processing...' :
                                    incident.escalation_status === 'completed'
                                        ? 'Max Level'
                                        : `Escalate (L${(incident.current_escalation_level || 0) + 1})`}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full p-4">
                    <div className="flex">
                        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="ml-3">
                            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
