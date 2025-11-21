'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../lib/api';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';

export default function DeploymentModal({ onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        name: '',
        cf_account_id: '',
        cf_api_token: '',
        worker_name: 'slar-uptime-worker'
    });
    const [deploying, setDeploying] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setDeploying(true);
        try {
            await apiClient.deployMonitorWorker(formData);
            toast.success('Worker deployed successfully!');
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Deployment failed:', error);
            const errorMessage = error.message || 'Deployment failed';
            toast.error(errorMessage);
        } finally {
            setDeploying(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title="Deploy Cloudflare Worker"
            size="md"
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Deployment Name
                    </label>
                    <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="Production Monitoring"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Cloudflare Account ID
                    </label>
                    <input
                        type="text"
                        required
                        value={formData.cf_account_id}
                        onChange={(e) => setFormData({ ...formData, cf_account_id: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Cloudflare API Token
                    </label>
                    <input
                        type="password"
                        required
                        value={formData.cf_api_token}
                        onChange={(e) => setFormData({ ...formData, cf_api_token: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Worker Name
                    </label>
                    <input
                        type="text"
                        required
                        value={formData.worker_name}
                        onChange={(e) => setFormData({ ...formData, worker_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                    />
                </div>

                <ModalFooter>
                    <ModalButton variant="secondary" onClick={onClose}>
                        Cancel
                    </ModalButton>
                    <ModalButton type="submit" loading={deploying}>
                        {deploying ? 'Deploying...' : 'Deploy'}
                    </ModalButton>
                </ModalFooter>
            </form>
        </Modal>
    );
}
