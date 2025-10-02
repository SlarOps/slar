'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MarkdownRenderer } from '../ui';

export default function IncidentCard({ incident, onAction, showActions = true }) {
  const [actionLoading, setActionLoading] = useState(false);

  const getStatusColor = (status) => {
    switch (status) {
      case 'triggered':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'acknowledged':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      case 'resolved':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 border-green-200 dark:border-green-800';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300 border-gray-200 dark:border-gray-700';
    }
  };

  const getUrgencyColor = (urgency) => {
    return urgency === 'high' 
      ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'error':
        return '🟠';
      case 'warning':
        return '🟡';
      case 'info':
        return '🔵';
      default:
        return '⚪';
    }
  };

  const handleAction = async (action) => {
    if (actionLoading) return;
    
    setActionLoading(true);
    try {
      await onAction(action, incident.id);
    } finally {
      setActionLoading(false);
    }
  };

  const formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow ${
      incident.urgency === 'high' ? 'border-l-4 border-l-red-500' : ''
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-lg">{getSeverityIcon(incident.severity)}</span>
            <Link 
              href={`/incidents?modal=${incident.id}`}
              className="text-lg font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              {incident.title}
            </Link>
          </div>
          
          <div className="flex items-center space-x-2 mb-2">
            <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(incident.status)}`}>
              {incident.status.toUpperCase()}
            </span>
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getUrgencyColor(incident.urgency)}`}>
              {incident.urgency.toUpperCase()}
            </span>
            {incident.priority && (
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                {incident.priority}
              </span>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        {showActions && incident.status !== 'resolved' && (
          <div className="flex space-x-1 ml-4">
            {incident.status === 'triggered' && (
              <button
                onClick={() => handleAction('acknowledge')}
                disabled={actionLoading}
                className="p-2 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors disabled:opacity-50"
                title="Acknowledge"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
            )}
            
            <button
              onClick={() => handleAction('resolve')}
              disabled={actionLoading}
              className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50"
              title="Resolve"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Description */}
      {incident.description && (
        <div className="mb-3 line-clamp-2">
          <MarkdownRenderer
            content={incident.description}
            size="sm"
            className="text-sm text-gray-600 dark:text-gray-400"
          />
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center space-x-4">
          <span>#{incident.id.slice(-8)}</span>
          
          {incident.assigned_to_name && (
            <span className="flex items-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>{incident.assigned_to_name}</span>
            </span>
          )}
          
          {incident.service_name && (
            <span className="flex items-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              <span>{incident.service_name}</span>
            </span>
          )}
          
          {incident.alert_count > 1 && (
            <span className="flex items-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10m-10 0a2 2 0 00-2 2v14a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2" />
              </svg>
              <span>{incident.alert_count} alerts</span>
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {incident.source && (
            <span className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">
              {incident.source}
            </span>
          )}
          <span>{formatTimeAgo(incident.created_at)}</span>
        </div>
      </div>

      {/* Escalation Status */}
      {incident.escalation_status && incident.escalation_status !== 'none' && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2 text-xs">
            <svg className="w-3 h-3 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-orange-600 dark:text-orange-400 font-medium">
              Escalation: {incident.escalation_status}
            </span>
            {incident.current_escalation_level > 0 && (
              <span className="text-gray-500 dark:text-gray-400">
                (Level {incident.current_escalation_level})
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
