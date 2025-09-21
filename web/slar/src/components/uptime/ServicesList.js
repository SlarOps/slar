'use client';

import { useState, useEffect } from 'react';
import ServiceCard from './ServiceCard';

const MOCK_SERVICES = [
  {
    id: '1',
    name: 'Main API',
    url: 'https://api.example.com/health',
    type: 'https',
    method: 'GET',
    interval: 300,
    timeout: 30,
    is_active: true,
    is_enabled: true,
    expected_status: 200,
    last_status: 'up',
    last_response_time: 156,
    last_checked_at: '2024-01-15T10:45:00Z',
    uptime_percentage: 99.95,
    ssl_expiry: '2024-12-31T23:59:59Z',
    ssl_days_left: 351,
    incident_count: 0,
    created_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '2',
    name: 'Database Health',
    url: 'http://db.internal.com:5432',
    type: 'tcp',
    interval: 180,
    timeout: 10,
    is_active: true,
    is_enabled: true,
    last_status: 'up',
    last_response_time: 45,
    last_checked_at: '2024-01-15T10:44:00Z',
    uptime_percentage: 99.8,
    incident_count: 0,
    created_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '3',
    name: 'Frontend App',
    url: 'https://app.example.com',
    type: 'https',
    method: 'GET',
    interval: 600,
    timeout: 30,
    is_active: true,
    is_enabled: true,
    expected_status: 200,
    last_status: 'down',
    last_response_time: 0,
    last_checked_at: '2024-01-15T10:43:00Z',
    uptime_percentage: 98.1,
    ssl_expiry: '2024-02-15T23:59:59Z',
    ssl_days_left: 31,
    incident_count: 2,
    created_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '4',
    name: 'Cache Server',
    url: '10.0.1.50',
    type: 'ping',
    interval: 120,
    timeout: 5,
    is_active: true,
    is_enabled: false,
    last_status: 'timeout',
    last_response_time: 5000,
    last_checked_at: '2024-01-15T10:42:00Z',
    uptime_percentage: 95.2,
    incident_count: 1,
    created_at: '2024-01-01T00:00:00Z'
  }
];

export default function ServicesList({ filters, onServiceAction, onAddService, onEditService }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      try {
        // TODO: Replace with actual API call
        // const data = await apiClient.getServices(filters);
        
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Apply filters to mock data
        let filteredServices = [...MOCK_SERVICES];
        
        // Search filter
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          filteredServices = filteredServices.filter(service =>
            service.name.toLowerCase().includes(searchLower) ||
            service.url.toLowerCase().includes(searchLower)
          );
        }
        
        // Type filter
        if (filters.type) {
          filteredServices = filteredServices.filter(service => service.type === filters.type);
        }
        
        // Status filter
        if (filters.status) {
          filteredServices = filteredServices.filter(service => service.last_status === filters.status);
        }
        
        // Sort
        switch (filters.sort) {
          case 'created_at_asc':
            filteredServices.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            break;
          case 'created_at_desc':
            filteredServices.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            break;
          case 'name_asc':
            filteredServices.sort((a, b) => a.name.localeCompare(b.name));
            break;
          case 'uptime_desc':
            filteredServices.sort((a, b) => (b.uptime_percentage || 0) - (a.uptime_percentage || 0));
            break;
          case 'response_time_asc':
            filteredServices.sort((a, b) => (a.last_response_time || 0) - (b.last_response_time || 0));
            break;
          default:
            break;
        }
        
        setServices(filteredServices);
        setError(null);
      } catch (err) {
        setError(err.message);
        setServices([]);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, [filters]);

  const handleEditService = (serviceId) => {
    console.log('Editing service:', serviceId);
    onEditService(serviceId);
  };

  const handleDeleteService = async (serviceId) => {
    if (!window.confirm('Are you sure you want to delete this service? This action cannot be undone.')) {
      return;
    }

    try {
      // TODO: Implement API call
      console.log('Deleting service:', serviceId);
      
      // Optimistically update UI
      setServices(prev => prev.filter(service => service.id !== serviceId));
      
      if (onServiceAction) {
        onServiceAction('delete', serviceId);
      }
    } catch (error) {
      console.error('Failed to delete service:', error);
      // TODO: Show error notification
    }
  };

  const handleToggleStatus = async (serviceId, newStatus) => {
    try {
      // TODO: Implement API call
      console.log('Toggling service status:', serviceId, newStatus);
      
      // Optimistically update UI
      setServices(prev => prev.map(service => 
        service.id === serviceId 
          ? { ...service, is_enabled: newStatus, updated_at: new Date().toISOString() }
          : service
      ));
      
      if (onServiceAction) {
        onServiceAction('toggle', serviceId);
      }
    } catch (error) {
      console.error('Failed to toggle service status:', error);
      // TODO: Show error notification
    }
  };

  const handleCheckNow = async (serviceId) => {
    try {
      // TODO: Implement API call
      console.log('Running health check for service:', serviceId);
      
      // Optimistically update UI to show checking state
      setServices(prev => prev.map(service => 
        service.id === serviceId 
          ? { ...service, last_checked_at: new Date().toISOString() }
          : service
      ));
      
      if (onServiceAction) {
        onServiceAction('check', serviceId);
      }
    } catch (error) {
      console.error('Failed to check service:', error);
      // TODO: Show error notification
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="animate-pulse space-y-3">
              <div className="flex gap-2">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
              </div>
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
        <div className="text-red-600 dark:text-red-400 mb-2">
          <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Error loading services
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
        <div className="text-gray-400 dark:text-gray-500 mb-3">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No services found</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {Object.values(filters).some(v => v) 
            ? 'Try adjusting your filters to see more results.'
            : 'Get started by adding your first service to monitor.'
          }
        </p>
        <button
          onClick={onAddService}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add First Service
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {services.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          onEdit={handleEditService}
          onDelete={handleDeleteService}
          onToggleStatus={handleToggleStatus}
          onCheckNow={handleCheckNow}
        />
      ))}
    </div>
  );
}
