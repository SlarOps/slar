import { useState } from 'react';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';
import toast from 'react-hot-toast';
import { apiClient } from '../../lib/api';

export default function WorkerDetailsModal({ deployment, onClose, onUpdate, onDeleteClick }) {
    const [redeploying, setRedeploying] = useState(false);

    const handleRedeploy = async () => {
        if (!confirm('Redeploy this worker with latest code?')) return;

        try {
            setRedeploying(true);
            await apiClient.redeployMonitorWorker(deployment.id);
            toast.success('Worker redeployed successfully');
            onUpdate();
        } catch (error) {
            console.error('Failed to redeploy:', error);
            toast.error('Failed to redeploy worker');
        } finally {
            setRedeploying(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={deployment.name}
            size="lg"
        >
            <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Worker Name</h4>
                        <p className="font-mono text-sm text-gray-900 dark:text-white break-all">
                            {deployment.worker_name}
                        </p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Last Deployed</h4>
                        <p className="text-sm text-gray-900 dark:text-white">
                            {new Date(deployment.last_deployed_at).toLocaleString()}
                        </p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Cloudflare Account ID</h4>
                        <p className="font-mono text-sm text-gray-900 dark:text-white break-all">
                            {deployment.cf_account_id}
                        </p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Status</h4>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                            Active
                        </span>
                    </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">Actions</h4>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={handleRedeploy}
                            disabled={redeploying}
                            className="flex items-center px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
                        >
                            {redeploying ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Redeploying...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Redeploy Worker
                                </>
                            )}
                        </button>
                        <button
                            onClick={onDeleteClick}
                            className="flex items-center px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                        >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete Deployment
                        </button>
                    </div>
                </div>
            </div>

            <ModalFooter>
                <ModalButton onClick={onClose} variant="secondary">
                    Close
                </ModalButton>
            </ModalFooter>
        </Modal>
    );
}
