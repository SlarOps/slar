'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import ServiceModal from './ServiceModal';
import ServiceDetailsModal from './ServiceDetailsModal';
import CreateServiceScheduleModal from './CreateServiceScheduleModal';
import { ConfirmationModal, Toast, toast } from '../ui';

export default function ServicesTab({ groupId, onServiceCreate, members = [] }) {
  const { session } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [serviceModalMode, setServiceModalMode] = useState('create'); // 'create' or 'edit'
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showCreateScheduleModal, setShowCreateScheduleModal] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  
  // Confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'Confirm',
    isLoading: false
  });

  // Fetch services on component mount
  useEffect(() => {
    if (groupId && session?.access_token) {
      fetchServices();
    }
  }, [groupId, session]);

  const fetchServices = async () => {
    if (!session?.access_token || !groupId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);
      const response = await apiClient.getGroupServices(groupId);
      setServices(response.services || []);
    } catch (error) {
      console.error('Failed to fetch services:', error);
      toast.error('Failed to load services');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateService = () => {
    setServiceModalMode('create');
    setSelectedService(null);
    setShowServiceModal(true);
  };

  const handleServiceCreated = (newService) => {
    setServices(prev => [...prev, newService]);
    setShowServiceModal(false);
    setSelectedService(null);
    
    // Notify parent if callback provided
    if (onServiceCreate) {
      onServiceCreate(newService);
    }
  };

  const handleEditService = (service) => {
    setServiceModalMode('edit');
    setSelectedService(service);
    setShowServiceModal(true);
  };

  const handleServiceUpdated = (updatedService) => {
    setServices(prev => prev.map(s => s.id === updatedService.id ? updatedService : s));
    setShowServiceModal(false);
    setSelectedService(null);
  };

  const handleViewDetails = (service) => {
    setSelectedService(service);
    setShowDetailsModal(true);
  };

  const handleCreateServiceSchedule = (service) => {
    setSelectedService(service);
    setShowCreateScheduleModal(true);
  };

  const handleServiceScheduleCreated = (schedule) => {
    setShowCreateScheduleModal(false);
    setSelectedService(null);
    toast.success('Service schedule created successfully!');
    
    // Notify parent if callback provided
    if (onServiceCreate) {
      onServiceCreate({ action: 'schedule_created', service: selectedService, schedule });
    }
  };

  const handleDeleteService = (service) => {
    setConfirmationModal({
      isOpen: true,
      title: 'Delete Service',
      message: `Are you sure you want to delete "${service.name}"? This action cannot be undone.`,
      onConfirm: () => confirmDeleteService(service.id),
      confirmText: 'Delete',
      isLoading: false
    });
  };

  const confirmDeleteService = async (serviceId) => {
    setConfirmationModal(prev => ({ ...prev, isLoading: true }));
    
    try {
      apiClient.setToken(session.access_token);
      await apiClient.deleteService(serviceId);
      
      setServices(prev => prev.filter(s => s.id !== serviceId));
      setConfirmationModal({ isOpen: false, title: '', message: '', onConfirm: null, confirmText: 'Confirm', isLoading: false });
      toast.success('Service deleted successfully!');
    } catch (error) {
      console.error('Failed to delete service:', error);
      toast.error('Failed to delete service: ' + error.message);
      setConfirmationModal(prev => ({ ...prev, isLoading: false }));
    }
  };

  const closeConfirmation = () => {
    setConfirmationModal({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: null,
      confirmText: 'Confirm',
      isLoading: false
    });
  };

  const getServiceStatus = (service) => {
    // Simple health check based on service data
    if (service.alert_count > 0) return 'critical';
    if (service.incident_count > 0) return 'warning';
    return 'healthy';
  };

  const getServiceType = (service) => {
    // Determine service type from routing key or name
    const name = service.name.toLowerCase();
    if (name.includes('web') || name.includes('frontend')) return 'Web';
    if (name.includes('api') || name.includes('backend')) return 'API';
    if (name.includes('database') || name.includes('db')) return 'Database';
    if (name.includes('monitoring') || name.includes('metrics')) return 'Monitoring';
    return 'Service';
  };

  return (
    <div className="">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
            Services
          </h2>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
            Monitor and manage services assigned to this group
          </p>
        </div>
        <button
          onClick={handleCreateService}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Service
        </button>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="space-y-3 sm:space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 animate-pulse">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <div className="h-4 sm:h-5 bg-gray-200 dark:bg-gray-700 rounded w-24 sm:w-32"></div>
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12 sm:w-16"></div>
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-10 sm:w-12"></div>
                  </div>
                  <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4 sm:w-48"></div>
                </div>
                <div className="flex sm:flex-col gap-2">
                  <div className="flex-1 sm:flex-none h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="flex gap-1.5">
                    <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : services && services.length > 0 ? (
        <div className="space-y-4">
          {services.map((service) => {
            const status = getServiceStatus(service);
            const type = getServiceType(service);
            
            return (
              <div
                key={service.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  {/* Content Section */}
                  <div className="flex-1 min-w-0">
                    {/* Title and Badges */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                      <h3 className="font-medium text-sm sm:text-base text-gray-900 dark:text-white truncate">
                        {service.name}
                      </h3>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex px-1.5 sm:px-2 py-0.5 text-xs font-medium rounded-full ${
                          status === 'healthy'
                            ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
                            : status === 'warning'
                            ? 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30'
                            : 'text-red-600 bg-red-100 dark:bg-red-900/30'
                        }`}>
                          {status}
                        </span>
                        <span className="inline-flex px-1.5 sm:px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                          {type}
                        </span>
                        {service.is_active === false && (
                          <span className="inline-flex px-1.5 sm:px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400">
                            Inactive
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {service.description || 'No description provided'}
                    </p>

                    {/* Metadata */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="flex-shrink-0">Routing Key:</span>
                        <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs truncate">
                          {service.routing_key}
                        </code>
                      </div>
                      {service.alert_count > 0 && (
                        <div className="text-red-600 flex-shrink-0">
                          {service.alert_count} active alert{service.alert_count !== 1 ? 's' : ''}
                        </div>
                      )}
                      {service.incident_count > 0 && (
                        <div className="text-yellow-600 flex-shrink-0">
                          {service.incident_count} incident{service.incident_count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Section */}
                  <div className="flex sm:flex-col gap-2 sm:gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleCreateServiceSchedule(service)}
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 border border-green-200 dark:border-green-800 rounded transition-colors whitespace-nowrap"
                      title="Create schedule for this service"
                    >
                      <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Schedule</span>
                    </button>
                    <div className="flex gap-1.5 sm:gap-1">
                      <button
                        onClick={() => handleViewDetails(service)}
                        className="p-1.5 sm:p-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        title="View service details"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleEditService(service)}
                        className="p-1.5 sm:p-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        title="Edit service"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteService(service)}
                        className="p-1.5 sm:p-2 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        title="Delete service"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6 sm:py-8 px-4 text-gray-500 dark:text-gray-400">
          <svg className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 002 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          <p className="text-sm sm:text-base mb-2">No services configured for this group yet.</p>
          <p className="text-xs sm:text-sm mb-4">Services help organize your monitoring and on-call schedules.</p>
          <button
            onClick={handleCreateService}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Add the first service
          </button>
        </div>
      )}

      {/* Modals */}
      <ServiceModal
        isOpen={showServiceModal}
        onClose={() => {
          setShowServiceModal(false);
          setSelectedService(null);
        }}
        mode={serviceModalMode}
        service={selectedService}
        groupId={groupId}
        onServiceCreated={handleServiceCreated}
        onServiceUpdated={handleServiceUpdated}
      />

      {showDetailsModal && selectedService && (
        <ServiceDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedService(null);
          }}
          service={selectedService}
          onEdit={() => {
            setShowDetailsModal(false);
            handleEditService(selectedService);
          }}
          onDelete={() => {
            setShowDetailsModal(false);
            handleDeleteService(selectedService);
          }}
        />
      )}

      {showCreateScheduleModal && selectedService && (
        <CreateServiceScheduleModal
          isOpen={showCreateScheduleModal}
          onClose={() => {
            setShowCreateScheduleModal(false);
            setSelectedService(null);
          }}
          service={selectedService}
          groupId={groupId}
          members={members}
          onScheduleCreated={handleServiceScheduleCreated}
        />
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmationModal.isOpen}
        onClose={closeConfirmation}
        onConfirm={confirmationModal.onConfirm}
        title={confirmationModal.title}
        message={confirmationModal.message}
        confirmText={confirmationModal.confirmText}
        cancelText="Cancel"
        loading={confirmationModal.isLoading}
        variant="danger"
      />

      {/* Toast Notifications */}
      <Toast />
    </div>
  );
}
