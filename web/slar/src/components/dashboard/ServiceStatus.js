'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const MOCK_SERVICES = [
  {
    id: '1',
    name: 'API Gateway',
    status: 'up',
    response_time: 120,
    uptime: 99.9,
    last_check: '2024-01-15T10:45:00Z'
  },
  {
    id: '2',
    name: 'Database',
    status: 'up',
    response_time: 45,
    uptime: 99.95,
    last_check: '2024-01-15T10:45:00Z'
  },
  {
    id: '3',
    name: 'Redis Cache',
    status: 'down',
    response_time: 0,
    uptime: 98.1,
    last_check: '2024-01-15T10:44:00Z'
  },
  {
    id: '4',
    name: 'Web Frontend',
    status: 'up',
    response_time: 200,
    uptime: 99.8,
    last_check: '2024-01-15T10:45:00Z'
  }
];

function getStatusColor(status) {
  switch (status) {
    case 'up': return 'text-green-600 bg-green-100 dark:bg-green-900/30';
    case 'down': return 'text-red-600 bg-red-100 dark:bg-red-900/30';
    case 'degraded': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30';
    default: return 'text-gray-600 bg-gray-100 dark:bg-gray-900/30';
  }
}

function getStatusIcon(status) {
  switch (status) {
    case 'up':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      );
    case 'down':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      );
    case 'degraded':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
    default:
      return null;
  }
}

function formatUptime(uptime) {
  return `${uptime.toFixed(2)}%`;
}

function formatResponseTime(responseTime) {
  if (responseTime === 0) return 'N/A';
  return `${responseTime}ms`;
}

export default function ServiceStatus({ limit = 4 }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Simulate API call
    const fetchServices = async () => {
      try {
        // TODO: Replace with actual API call
        // const data = await apiClient.getServices();
        setTimeout(() => {
          setServices(MOCK_SERVICES.slice(0, limit));
          setLoading(false);
        }, 1200);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchServices();
  }, [limit]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Service Status</h3>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Service Status</h3>
        <p className="text-red-600 dark:text-red-400">Error loading services: {error}</p>
      </div>
    );
  }

  const upServices = services.filter(s => s.status === 'up').length;
  const totalServices = services.length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Service Status</h3>
        <Link 
          href="/uptime" 
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          View all
        </Link>
      </div>
      
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">
            {upServices}/{totalServices} services operational
          </span>
          <div className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
            upServices === totalServices 
              ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
              : 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30'
          }`}>
            {upServices === totalServices ? 'All systems operational' : 'Some issues detected'}
          </div>
        </div>
      </div>

      {services.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No services configured</p>
      ) : (
        <div className="space-y-3">
          {services.map((service) => (
            <div 
              key={service.id}
              className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getStatusColor(service.status)}`}>
                  {getStatusIcon(service.status)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {service.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatResponseTime(service.response_time)} • {formatUptime(service.uptime)} uptime
                  </p>
                </div>
              </div>
              
              <div className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(service.status)}`}>
                {service.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
