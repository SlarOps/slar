'use client';

import { useState, useEffect } from 'react';
import { PlusIcon, TrashIcon, KeyIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import { credentialsService } from '@/services/credentials-service';
import Modal, { ModalFooter, ModalButton } from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';

const CredentialsPage = () => {
    const { session } = useAuth();
    const [credentials, setCredentials] = useState([]);
    const [loading, setLoading] = useState(true);
    const [vaultAvailable, setVaultAvailable] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [toast, setToast] = useState(null);

    useEffect(() => {
        if (!session?.access_token) return;
        credentialsService.setToken(session.access_token);

        const init = async () => {
            const status = await credentialsService.getVaultStatus();
            setVaultAvailable(status.vault_available);
            if (status.vault_available) {
                await fetchCredentials();
            } else {
                setLoading(false);
            }
        };
        init();
    }, [session?.access_token]);

    const fetchCredentials = async () => {
        setLoading(true);
        const data = await credentialsService.listCredentials();
        if (data.success) {
            setCredentials(data.credentials);
        } else {
            showToast('Failed to load credentials', 'error');
        }
        setLoading(false);
    };

    const handleDeleteCredential = async (credential) => {
        if (!confirm(`Are you sure you want to delete "${credential.name}"?`)) return;

        const data = await credentialsService.deleteCredential(credential.type, credential.name);
        if (data.success) {
            showToast(`Credential "${credential.name}" deleted`, 'success');
            fetchCredentials();
        } else {
            showToast('Failed to delete credential', 'error');
        }
    };

    const showToast = (message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    return (
        <div className="min-h-screen dark:bg-gray-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Credentials</h1>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Securely manage secrets stored in Vault
                        </p>
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        disabled={!vaultAvailable}
                        className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <PlusIcon className="h-5 w-5 mr-2" />
                        Add Credential
                    </button>
                </div>

                {/* Vault Warning */}
                {!vaultAvailable && (
                    <div className="mb-6 flex items-center gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                        <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">Vault Unavailable</p>
                            <p className="text-xs text-yellow-700 dark:text-yellow-300">
                                HashiCorp Vault is not connected. Storing and retrieving credentials is disabled.
                            </p>
                        </div>
                    </div>
                )}

                {/* Credentials List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
                    </div>
                ) : credentials.length === 0 ? (
                    <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <KeyIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Credentials Yet</h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-4">
                            Add credentials to connect to services securely
                        </p>
                        <button
                            onClick={() => setShowAddModal(true)}
                            disabled={!vaultAvailable}
                            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <PlusIcon className="h-5 w-5 mr-2" />
                            Add Your First Credential
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {credentials.map(credential => (
                            <div
                                key={`${credential.type}-${credential.name}`}
                                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <h3 className="font-semibold text-gray-900 dark:text-white">{credential.name}</h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">{credential.type_name}</p>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteCredential(credential)}
                                        className="text-gray-400 hover:text-red-600 transition-colors"
                                    >
                                        <TrashIcon className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add Modal */}
                <AddCredentialModal
                    isOpen={showAddModal}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={() => {
                        setShowAddModal(false);
                        fetchCredentials();
                        showToast('Credential added successfully', 'success');
                    }}
                    onError={(msg) => showToast(msg, 'error')}
                />

                {/* Toast */}
                {toast && (
                    <div className="fixed bottom-4 right-4 z-50">
                        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${
                            toast.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
                            toast.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                            'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                        }`}>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{toast.message}</span>
                            <button onClick={() => setToast(null)} className="ml-2 text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Add Credential Modal
const AddCredentialModal = ({ isOpen, onClose, onSuccess, onError }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [value, setValue] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!name.trim() || !value.trim()) return;
        setSubmitting(true);

        const result = await credentialsService.storeCredential({
            credential_type: 'generic_api_key',
            credential_name: name.trim(),
            description: description.trim(),
            data: { value }
        });

        if (result.success) {
            setName('');
            setDescription('');
            setValue('');
            onSuccess();
        } else {
            onError(result.message || result.error || 'Failed to add credential');
        }
        setSubmitting(false);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Add Credential"
            size="md"
            footer={
                <ModalFooter>
                    <ModalButton variant="secondary" onClick={onClose}>Cancel</ModalButton>
                    <ModalButton
                        variant="primary"
                        onClick={handleSubmit}
                        loading={submitting}
                        disabled={!name.trim() || !value.trim()}
                    >
                        Save
                    </ModalButton>
                </ModalFooter>
            }
        >
            <div className="space-y-4 px-1">
                <Input
                    label="Name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., my_github_token"
                />
                <Input
                    label="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                />
                <Textarea
                    label="Value"
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Token, JSON, connection string, PEM key, etc."
                    rows={6}
                    className="font-mono"
                    helperText="Stored encrypted in Vault."
                />
            </div>
        </Modal>
    );
};

export default CredentialsPage;
