'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function IncidentsTable({ 
  incidents = [], 
  loading = false, 
  onIncidentAction,
  selectedIncidents = [],
  onIncidentSelect,
  onSelectAll
}) {
  const router = useRouter();
  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' });

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getStatusBadge = (status) => {
    const statusStyles = {
      triggered: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300',
      acknowledged: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
      resolved: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown'}
      </span>
    );
  };

  const getPriorityBadge = (priority) => {
    if (!priority) return <span className="text-gray-400 text-sm">--</span>;
    
    const priorityStyles = {
      P0: 'bg-red-600 text-white',
      P1: 'bg-orange-500 text-white', 
      P2: 'bg-yellow-500 text-white',
      P3: 'bg-blue-500 text-white',
      P4: 'bg-gray-500 text-white'
    };

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${priorityStyles[priority] || 'bg-gray-500 text-white'}`}>
        {priority}
      </span>
    );
  };

  const getUrgencyIcon = (urgency) => {
    if (urgency === 'high') {
      return (
        <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
    }
    return null;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '--';
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));
    
    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now - date) / (1000 * 60));
      return `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const handleIncidentClick = (incidentId) => {
    router.push(`/incidents?modal=${incidentId}`, undefined, { shallow: true });
  };

  const handleActionClick = (e, action, incidentId) => {
    e.stopPropagation();
    onIncidentAction(action, incidentId);
  };

  const isAllSelected = incidents.length > 0 && selectedIncidents.length === incidents.length;
  const isIndeterminate = selectedIncidents.length > 0 && selectedIncidents.length < incidents.length;

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            {/* Header Skeleton */}
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th scope="col" className="w-8 px-6 py-3">
                  <div className="animate-pulse">
                    <div className="h-4 w-4 bg-gray-300 dark:bg-gray-600 rounded"></div>
                  </div>
                </th>
                <th scope="col" className="px-3 py-3 text-left w-24">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-12"></div>
                  </div>
                </th>
                <th scope="col" className="px-3 py-3 text-left w-20">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-14"></div>
                  </div>
                </th>
                <th scope="col" className="px-3 py-3 text-left w-24">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-14"></div>
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-10"></div>
                  </div>
                </th>
                <th scope="col" className="px-4 py-3 text-left w-28">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-12"></div>
                  </div>
                </th>
                <th scope="col" className="px-4 py-3 text-left w-32">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-12"></div>
                  </div>
                </th>
                <th scope="col" className="px-4 py-3 text-left w-32">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                  </div>
                </th>
                <th scope="col" className="px-4 py-3 text-center w-20">
                  <div className="animate-pulse">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-6 mx-auto"></div>
                  </div>
                </th>
              </tr>
            </thead>
            
            {/* Body Skeleton */}
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  {/* Checkbox */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="animate-pulse">
                      <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    </div>
                  </td>
                  
                  {/* Status */}
                  <td className="px-3 py-4 whitespace-nowrap">
                    <div className="animate-pulse">
                      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-16"></div>
                    </div>
                  </td>
                  
                  {/* Priority */}
                  <td className="px-3 py-4 whitespace-nowrap">
                    <div className="animate-pulse">
                      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-14"></div>
                    </div>
                  </td>
                  
                  {/* Urgency */}
                  <td className="px-3 py-4 whitespace-nowrap">
                    <div className="animate-pulse flex items-center">
                      <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded mr-2"></div>
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
                    </div>
                  </td>
                  
                  {/* Title */}
                  <td className="px-6 py-4">
                    <div className="animate-pulse">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-2"></div>
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-1"></div>
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
                    </div>
                  </td>
                  
                  {/* Created */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="animate-pulse">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16 mb-1"></div>
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
                    </div>
                  </td>
                  
                  {/* Service */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="animate-pulse">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
                    </div>
                  </td>
                  
                  {/* Assignee */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="animate-pulse flex items-center">
                      <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded-full mr-2"></div>
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                    </div>
                  </td>
                  
                  {/* Ack */}
                  <td className="px-4 py-4 whitespace-nowrap text-center">
                    <div className="animate-pulse">
                      <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded mx-auto"></div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-8 text-center">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No incidents</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Get started by creating a new incident.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th scope="col" className="w-8 px-6 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  checked={isAllSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = isIndeterminate;
                  }}
                  onChange={(e) => onSelectAll(e.target.checked)}
                />
              </th>
              
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">
                <button
                  onClick={() => handleSort('status')}
                  className="flex items-center space-x-1 hover:text-gray-700 dark:hover:text-gray-100"
                >
                  <span>Status</span>
                  {sortConfig.key === 'status' && (
                    <svg className={`w-3 h-3 ${sortConfig.direction === 'asc' ? 'transform rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </th>

              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-20">
                Priority
              </th>

              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">
                <button
                  onClick={() => handleSort('urgency')}
                  className="flex items-center space-x-1 hover:text-gray-700 dark:hover:text-gray-100"
                >
                  <span>Urgency</span>
                  {sortConfig.key === 'urgency' && (
                    <svg className={`w-3 h-3 ${sortConfig.direction === 'asc' ? 'transform rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </th>



              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                <button
                  onClick={() => handleSort('title')}
                  className="flex items-center space-x-1 hover:text-gray-700 dark:hover:text-gray-100"
                >
                  <span>Title</span>
                  {sortConfig.key === 'title' && (
                    <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? 'transform rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </th>

              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-28">
                <button
                  onClick={() => handleSort('created_at')}
                  className="flex items-center space-x-1 hover:text-gray-700 dark:hover:text-gray-100"
                >
                  <span>Created</span>
                  {sortConfig.key === 'created_at' && (
                    <svg className={`w-3 h-3 ${sortConfig.direction === 'asc' ? 'transform rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </th>

              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-32">
                Service
              </th>

              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-32">
                Assignee
              </th>

              <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-20">
                Ack
              </th>
            </tr>
          </thead>
          
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {incidents.map((incident) => (
              <tr
                key={incident.id}
                className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                onClick={() => handleIncidentClick(incident.id)}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    checked={selectedIncidents.includes(incident.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      onIncidentSelect(incident.id, e.target.checked);
                    }}
                  />
                </td>

                <td className="px-3 py-4 whitespace-nowrap">
                  {getStatusBadge(incident.status)}
                </td>

                <td className="px-3 py-4 whitespace-nowrap">
                  {getPriorityBadge(incident.priority)}
                </td>

                <td className="px-3 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    {getUrgencyIcon(incident.urgency)}
                    <span className="ml-1 text-sm text-gray-900 dark:text-white capitalize">
                      {incident.urgency || 'Normal'}
                    </span>
                  </div>
                </td>



                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900 dark:text-white">
                    <div className="font-medium">{incident.title}</div>
                    {incident.description && (
                      <div className="text-gray-500 dark:text-gray-400 truncate max-w-md">
                        {incident.description}
                      </div>
                    )}
                    {incident.incident_number && (
                      <div className="text-xs text-gray-400 mt-1">
                        #{incident.incident_number}
                      </div>
                    )}
                  </div>
                </td>

                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {formatDate(incident.created_at)}
                </td>

                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {incident.service_name ? (
                    <span className="text-blue-600 dark:text-blue-400 hover:underline truncate block max-w-28">
                      {incident.service_name}
                    </span>
                  ) : (
                    <span className="text-gray-400">--</span>
                  )}
                </td>

                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {incident.assigned_to_name ? (
                    <span className="text-blue-600 dark:text-blue-400 hover:underline truncate block max-w-28">
                      {incident.assigned_to_name}
                    </span>
                  ) : (
                    <span className="text-gray-400">Unassigned</span>
                  )}
                </td>

                <td className="px-4 py-4 whitespace-nowrap text-center text-sm font-medium">
                  {incident.status === 'triggered' && (
                    <button
                      onClick={(e) => handleActionClick(e, 'acknowledge', incident.id)}
                      className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 p-2 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      title="Acknowledge"
                    >
                      Acknowledge
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
