'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../lib/api';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';

export default function DeleteDeploymentModal({ deployment, onClose, onSuccess }) {
    const [keepDatabase, setKeepDatabase] = useState(true);
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        try {
            setDeleting(true);
            await apiClient.deleteMonitorDeployment(deployment.id, keepDatabase);
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
