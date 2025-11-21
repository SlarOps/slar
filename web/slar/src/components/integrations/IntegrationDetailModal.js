'use client';

import { useState } from 'react';
import { Modal, ModalFooter, ModalButton } from '../ui';
import {
  FireIcon,
  ChartBarIcon,
  LinkIcon,
  CloudIcon,
  BoltIcon,
  CubeIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

export default function IntegrationDetailModal({
  isOpen,
  onClose,
  integration,
  onEdit
}) {
  const [copied, setCopied] = useState(false);

  if (!integration) return null;

  const getIntegrationTypeIcon = (type) => {
    const iconProps = "h-8 w-8";

    switch (type) {
      case 'prometheus':
        return <FireIcon className={`${iconProps} text-orange-600 dark:text-orange-400`} />;
      case 'datadog':
        return <ChartBarIcon className={`${iconProps} text-purple-600 dark:text-purple-400`} />;
      case 'grafana':
        return <ChartBarIcon className={`${iconProps} text-yellow-600 dark:text-yellow-400`} />;
      case 'webhook':
        return <LinkIcon className={`${iconProps} text-blue-600 dark:text-blue-400`} />;
      case 'aws':
        return <CloudIcon className={`${iconProps} text-amber-600 dark:text-amber-400`} />;
      case 'custom':
        return <CubeIcon className={`${iconProps} text-gray-600 dark:text-gray-400`} />;
      default:
        return <BoltIcon className={`${iconProps} text-gray-600 dark:text-gray-400`} />;
    }
  };

  const getHealthStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircleIcon className="h-6 w-6 text-green-500" />;
      case 'warning':
        return <ClockIcon className="h-6 w-6 text-yellow-500" />;
      case 'unhealthy':
        return <XCircleIcon className="h-6 w-6 text-red-500" />;
      default:
        return <ExclamationTriangleIcon className="h-6 w-6 text-gray-500" />;
    }
  };

  const getHealthStatusText = (status) => {
    switch (status) {
      case 'healthy':
        return 'Healthy';
      case 'warning':
        return 'Warning';
      case 'unhealthy':
        return 'Unhealthy';
      default:
        return 'Unknown';
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Integration Details"
      size="lg"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            Close
          </ModalButton>
          <ModalButton variant="primary" onClick={() => onEdit(integration)}>
            Edit Integration
          </ModalButton>
        </ModalFooter>
      }
    >
      <div className="space-y-6">
        {/* Integration Header */}
        <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="p-3 rounded-lg bg-white dark:bg-gray-700 shadow-sm">
            {getIntegrationTypeIcon(integration.type)}
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
              {integration.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
              {integration.type} Integration
            </p>
          </div>
          <div className="flex items-center gap-2">
            {getHealthStatusIcon(integration.health_status)}
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {getHealthStatusText(integration.health_status)}
            </span>
          </div>
        </div>

        {/* Description */}
        {integration.description && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description
            </label>
            <p className="text-sm text-gray-600 dark:text-gray-400 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              {integration.description}
            </p>
          </div>
        )}

        {/* Webhook URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Webhook URL
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg font-mono text-sm text-gray-600 dark:text-gray-400 break-all">
              {integration.webhook_url}
            </div>
            <button
              onClick={() => copyToClipboard(integration.webhook_url)}
              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Copy webhook URL"
            >
              <ClipboardDocumentIcon className="h-5 w-5" />
            </button>
          </div>
          {copied && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              ✓ Copied to clipboard
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Configure this URL in your {integration.type} to send alerts to SLAR
          </p>
        </div>

        {/* Integration Key/Secret */}
        {integration.webhook_secret && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Integration Key
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg font-mono text-sm text-gray-600 dark:text-gray-400">
                {integration.webhook_secret}
              </div>
              <button
                onClick={() => copyToClipboard(integration.webhook_secret)}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Copy integration key"
              >
                <ClipboardDocumentIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Use this key for webhook authentication and validation
            </p>
          </div>
        )}

        {/* Example Payload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Example Payload
          </label>
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap overflow-x-auto">
              {integration.type === 'datadog' && `{
  "id": "$ID",
  "last_updated": "$LAST_UPDATED",
  "event_type": "$EVENT_TYPE",
  "title": "$EVENT_TITLE",
  "date": "$DATE",
  "org": {
    "id": "$ORG_ID",
    "name": "$ORG_NAME"
  },
  "body": "$EVENT_MSG",
  "transition": "$ALERT_TRANSITION",
  "aggregate": "$AGGREG_KEY",
  "alert_priority": "$ALERT_PRIORITY",
  "alert_title": "$ALERT_TITLE",
  "alert_status": "$ALERT_STATUS",
  "alert_query": "$ALERT_QUERY",
  "alert_cycle_key": "$ALERT_CYCLE_KEY",
  "tags": "$TAGS"
}`}
              {integration.type === 'prometheus' && `{
  "version": "4",
  "groupKey": "{}:{alertname=\\"InstanceDown\\"}",
  "status": "firing",
  "receiver": "slar-webhook",
  "groupLabels": {
    "alertname": "InstanceDown"
  },
  "commonLabels": {
    "alertname": "InstanceDown",
    "instance": "localhost:9090",
    "job": "prometheus",
    "severity": "critical"
  },
  "commonAnnotations": {
    "description": "Instance localhost:9090 is down",
    "summary": "Instance down"
  },
  "externalURL": "http://prometheus:9093",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "InstanceDown",
        "instance": "localhost:9090",
        "job": "prometheus",
        "severity": "critical"
      },
      "annotations": {
        "description": "Instance localhost:9090 is down",
        "summary": "Instance down"
      },
      "startsAt": "2024-01-01T00:00:00Z",
      "endsAt": "0001-01-01T00:00:00Z"
    }
  ]
}`}
              {integration.type === 'webhook' && `{
  "title": "Alert Title",
  "description": "Alert description or message",
  "severity": "critical",
  "status": "firing",
  "source": "monitoring-system",
  "timestamp": "2024-01-01T00:00:00Z",
  "labels": {
    "service": "api",
    "environment": "production"
  },
  "annotations": {
    "summary": "Brief summary",
    "description": "Detailed description"
  }
}`}
              {!['datadog', 'prometheus', 'webhook'].includes(integration.type) && `{
  "message": "Alert message",
  "severity": "high",
  "timestamp": "${new Date().toISOString()}",
  "source": "${integration.type}"
}`}
            </pre>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Send a POST request with this payload structure to the webhook URL above
          </p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {integration.services_count || 0}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Connected Services
            </div>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {integration.heartbeat_interval || 300}s
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Heartbeat Interval
            </div>
          </div>
        </div>

        {/* Timestamps */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Created:</span>
            <span className="text-gray-900 dark:text-white">
              {formatDate(integration.created_at)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Last Updated:</span>
            <span className="text-gray-900 dark:text-white">
              {formatDate(integration.updated_at)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Last Heartbeat:</span>
            <span className="text-gray-900 dark:text-white">
              {formatDate(integration.last_heartbeat)}
            </span>
          </div>
        </div>

        {/* Configuration */}
        {integration.config && Object.keys(integration.config).length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Configuration
            </label>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                {JSON.stringify(integration.config, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
