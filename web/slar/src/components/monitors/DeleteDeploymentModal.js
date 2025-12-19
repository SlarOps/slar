'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';

export default function DeleteDeploymentModal({ deployment, onClose, onSuccess }) {
    const { session } = useAuth();
    const { currentOrg, currentProject } = useOrg();
    const [keepDatabase, setKeepDatabase] = useState(true);
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        if (!currentOrg?.id) {
            toast.error('Organization context required');
            return;
        }

        try {
            setDeleting(true);
            if (session?.access_token) {
                apiClient.setToken(session.access_token);
            }

            // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
            const rebacFilters = {
                org_id: currentOrg.id,
                ...(currentProject?.id && { project_id: currentProject.id })
            };

            await apiClient.deleteMonitorDeployment(deployment.id, keepDatabase, rebacFilters);
            toast.success(`Deployment deleted${keepDatabase ? ' (database kept)' : ''}`);
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Failed to delete deployment:', error);
            toast.error('Failed to delete deployment');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title="Delete Deployment"
            size="md"
        >
            <div className="space-y-4">
                <p className="text-gray-600 dark:text-gray-400">
                    Are you sure you want to delete <strong>{deployment.name}</strong>?
                </p>

                <div className="mb-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={keepDatabase}
                            onChange={(e) => setKeepDatabase(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                            Keep D1 database (recommended)
                        </span>
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                        Keeping the database preserves all historical monitoring data
                    </p>
                </div>

                <ModalFooter>
                    <ModalButton variant="secondary" onClick={onClose}>
                        Cancel
                    </ModalButton>
                    <ModalButton
                        variant="danger"
                        onClick={handleDelete}
                        loading={deleting}
                    >
                        {deleting ? 'Deleting...' : 'Delete'}
                    </ModalButton>
                </ModalFooter>
            </div>
        </Modal>
    );
}
