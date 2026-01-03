'use client';

import { Modal, ModalFooter, ModalButton } from '../ui';

// Get API base URL from environment
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.slar.io';

export default function ServiceDetailsModal({ isOpen, onClose, service, onEdit, onDelete }) {
  if (!service) return null;

  const getServiceType = (service) => {
    const name = service.name.toLowerCase();
    if (name.includes('web') || name.includes('frontend')) return 'Web';
    if (name.includes('api') || name.includes('backend')) return 'API';
    if (name.includes('database') || name.includes('db')) return 'Database';
    if (name.includes('monitoring') || name.includes('metrics')) return 'Monitoring';
    return 'Service';
  };

  const getServiceStatus = (service) => {
    if (service.alert_count > 0) return 'critical';
    if (service.incident_count > 0) return 'warning';
    return 'healthy';
  };

  const status = getServiceStatus(service);
  const type = getServiceType(service);

  // Generate webhook URLs (prefer backend-provided, fallback to construction)
  const genericWebhookUrl = service.generic_webhook_url || `${API_BASE_URL}/webhook/generic/${service.routing_key}`;
  const prometheusWebhookUrl = service.prometheus_webhook_url || `${API_BASE_URL}/webhook/prometheus/${service.routing_key}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <span>Service Details</span>
          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${status === 'healthy'
            ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
            : status === 'warning'
              ? 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30'
              : 'text-red-600 bg-red-100 dark:bg-red-900/30'
            }`}>
            {status}
          </span>
        </div>
      }
      size="lg"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            Close
          </ModalButton>
          <ModalButton variant="primary" onClick={onEdit}>
            Edit Service
          </ModalButton>
          <ModalButton variant="danger" onClick={onDelete}>
            Delete Service
          </ModalButton>
        </ModalFooter>
      }
    >
      <div>
        <div className="space-y-6">
          {/* Basic Information */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{service.name}</h2>
              <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                {type}
              </span>
              {service.is_active === false && (
                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400">
                  Inactive
                </span>
              )}
            </div>
            {service.description && (
              <p className="text-gray-600 dark:text-gray-400 mb-4">{service.description}</p>
            )}
          </div>

          {/* Webhook URLs */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Webhook URLs</h4>
            <div className="space-y-2">
              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Generic</span>
                  <button
                    onClick={() => navigator.clipboard?.writeText(genericWebhookUrl)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Copy
                  </button>
                </div>
                <code className="text-sm text-gray-900 dark:text-gray-100 font-mono break-all">
                  {genericWebhookUrl}
                </code>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Prometheus</span>
                  <button
                    onClick={() => navigator.clipboard?.writeText(prometheusWebhookUrl)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Copy
                  </button>
                </div>
                <code className="text-sm text-gray-900 dark:text-gray-100 font-mono break-all">
                  {prometheusWebhookUrl}
                </code>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Statistics</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-lg font-semibold text-red-600">{service.alert_count || 0}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Active Alerts</div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-lg font-semibold text-yellow-600">{service.incident_count || 0}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Incidents</div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-lg font-semibold text-gray-600 dark:text-gray-400">99.9%</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Uptime</div>
              </div>
            </div>
          </div>

          {/* Metadata */}
          {(service.created_at || service.updated_at) && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Metadata</h4>
              <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                {service.created_at && (
                  <div>Created: {new Date(service.created_at).toLocaleString()}</div>
                )}
                {service.updated_at && (
                  <div>Updated: {new Date(service.updated_at).toLocaleString()}</div>
                )}
                {service.created_by && (
                  <div>Created by: {service.created_by}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
