'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../lib/api';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';

export default function MonitorModal({ deploymentId, monitor, onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        deployment_id: deploymentId,
        name: monitor?.name || '',
        description: monitor?.description || '',
        url: monitor?.url || '',
        target: monitor?.target || '',
        method: monitor?.method || 'GET',
        timeout: monitor?.timeout || 10000,
        interval_seconds: monitor?.interval_seconds || 60,
        expect_status: monitor?.expect_status || 200,
        follow_redirect: monitor?.follow_redirect ?? true,
        is_active: monitor?.is_active ?? true,
        response_keyword: monitor?.response_keyword || '',
        response_forbidden_keyword: monitor?.response_forbidden_keyword || '',
        tooltip: monitor?.tooltip || '',
        status_page_link: monitor?.status_page_link || '',
        headers: monitor?.headers ? JSON.stringify(monitor.headers, null, 2) : '',
        body: monitor?.body || ''
    });
    const [saving, setSaving] = useState(false);

    const isTCPPing = formData.method === 'TCP_PING';
    const supportsBody = ['POST', 'PUT', 'PATCH'].includes(formData.method);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            // Prepare data based on method type
            const submitData = { ...formData };

            // Parse headers if provided
            if (submitData.headers) {
                try {
                    submitData.headers = JSON.parse(submitData.headers);
                } catch (e) {
                    toast.error('Invalid JSON in headers field');
                    setSaving(false);
                    return;
                }
            } else {
                submitData.headers = {};
            }

            // Clean up empty optional fields
            if (!submitData.response_keyword) delete submitData.response_keyword;
            if (!submitData.response_forbidden_keyword) delete submitData.response_forbidden_keyword;
            if (!submitData.tooltip) delete submitData.tooltip;
            if (!submitData.status_page_link) delete submitData.status_page_link;
            if (!submitData.body) delete submitData.body;
            if (!submitData.description) delete submitData.description;

            // For TCP_PING, ensure target is set
            if (isTCPPing && !submitData.target) {
                toast.error('Target (host:port) is required for TCP_PING');
                setSaving(false);
                return;
            }

            if (monitor) {
                await apiClient.updateMonitor(monitor.id, submitData);
                toast.success('Monitor updated successfully!');
            } else {
                await apiClient.createMonitor(submitData);
                toast.success('Monitor created successfully!');
            }

            onSuccess();
            onClose();
        } catch (error) {
            console.error('Failed to save monitor:', error);
            const errorMessage = error.message || 'Failed to save monitor';
            toast.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={monitor ? "Edit Monitor" : "Add Monitor"}
            size="2xl"
        >
            <form id="monitor-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    {/* Monitor Name */}
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Monitor Name *
                        </label>
                        <input
                            type="text"
                            required
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            placeholder="API Health Check"
                        />
                    </div>

                    {/* Description */}
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Description
                        </label>
                        <input
                            type="text"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            placeholder="Optional description"
                        />
                    </div>

                    {/* Method */}
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Method *
                        </label>
                        <select
                            value={formData.method}
                            onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            <optgroup label="HTTP Methods">
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="PATCH">PATCH</option>
                                <option value="DELETE">DELETE</option>
                                <option value="HEAD">HEAD</option>
                            </optgroup>
                            <optgroup label="TCP Monitoring">
                                <option value="TCP_PING">TCP_PING</option>
                            </optgroup>
                        </select>
                        {isTCPPing && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                TCP_PING checks if a TCP port is reachable
                            </p>
                        )}
                    </div>

                    {/* URL (for HTTP) or Target (for TCP) */}
                    {isTCPPing ? (
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Target (host:port) *
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.target}
                                onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                                placeholder="db.example.com:5432"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Examples: github.com:22 (SSH), db.example.com:3306 (MySQL)
                            </p>
                        </div>
                    ) : (
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                URL *
                            </label>
                            <input
                                type="url"
                                required
                                value={formData.url}
                                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                                placeholder="https://api.example.com/health"
                            />
                        </div>
                    )}

                    {/* HTTP-only fields */}
                    {!isTCPPing && (
                        <>
                            {/* Headers */}
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Headers (JSON)
                                </label>
                                <textarea
                                    value={formData.headers}
                                    onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                                    placeholder='{"Content-Type": "application/json"}'
                                    rows={2}
                                />
                            </div>

                            {/* Body (for POST/PUT/PATCH) */}
                            {supportsBody && (
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Request Body
                                    </label>
                                    <textarea
                                        value={formData.body}
                                        onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                                        placeholder='{"test": true}'
                                        rows={3}
                                    />
                                </div>
                            )}

                            {/* Expected Status */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Expected Status
                                </label>
                                <input
                                    type="number"
                                    value={formData.expect_status}
                                    onChange={(e) => setFormData({ ...formData, expect_status: parseInt(e.target.value) || 200 })}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    placeholder="200"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Leave as 200 for any 2xx status
                                </p>
                            </div>
                        </>
                    )}

                    {/* Interval */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Interval (seconds)
                        </label>
                        <input
                            type="number"
                            min="10"
                            value={formData.interval_seconds}
                            onChange={(e) => setFormData({ ...formData, interval_seconds: parseInt(e.target.value) || 60 })}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                    </div>

                    {/* Timeout */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Timeout (ms)
                        </label>
                        <input
                            type="number"
                            min="100"
                            value={formData.timeout}
                            onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 10000 })}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                    </div>

                    {/* Follow Redirects */}
                    {!isTCPPing && (
                        <div className="flex items-center mt-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.follow_redirect}
                                    onChange={(e) => setFormData({ ...formData, follow_redirect: e.target.checked })}
                                    className="w-4 h-4 text-blue-600 rounded"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                    Follow Redirects
                                </span>
                            </label>
                        </div>
                    )}
                </div>

                <ModalFooter>
                    <ModalButton variant="secondary" onClick={onClose}>
                        Cancel
                    </ModalButton>
                    <ModalButton type="submit" loading={saving}>
                        Create Monitor
                    </ModalButton>
                </ModalFooter>
            </form>
        </Modal>
    );
}
