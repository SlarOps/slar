'use client';

import { useState, useEffect } from 'react';
import { PlusIcon, TrashIcon, KeyIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import apiClient from '@/lib/api';
import Modal, { ModalFooter, ModalButton } from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Switch from '@/components/ui/Switch';

const CredentialsPage = () => {
    const { session } = useAuth();
    const { currentOrg, currentProject } = useOrg();
    const [credentials, setCredentials] = useState([]);
    const [loading, setLoading] = useState(true);
    const [vaultAvailable, setVaultAvailable] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [toast, setToast] = useState(null);
    const [userRole, setUserRole] = useState(null);

    const isAdmin = userRole === 'admin' || userRole === 'owner';
    const projectId = currentProject?.id;

    useEffect(() => {
        if (!session?.access_token) return;
        apiClient.setToken(session.access_token);

        if (!projectId) {
            setLoading(false);
            return;
        }

        const init = async () => {
            try {
                // Fetch role and vault status in parallel
                const [status, roleResult] = await Promise.all([
                    apiClient.getVaultStatus(),
                    apiClient.getCredentialRole(projectId),
                ]);
                setVaultAvailable(status.vault_available);
                setUserRole(roleResult.role);
                if (status.vault_available && roleResult.role) {
                    await fetchCredentials();
                } else {
                    setLoading(false);
                }
            } catch (err) {
                setVaultAvailable(false);
                setLoading(false);
            }
        };
        init();
    }, [session?.access_token, projectId]);

    const fetchCredentials = async () => {
        setLoading(true);
        try {
            const data = await apiClient.listCredentials(null, projectId);
            setCredentials(data.credentials || []);
        } catch (err) {
            showToast('Failed to load credentials', 'error');
        }
        setLoading(false);
    };

    const handleDeleteCredential = async (credential) => {
        if (!confirm(`Are you sure you want to delete "${credential.name}"?`)) return;
        try {
            await apiClient.deleteCredential(credential.type, credential.name, projectId);
            showToast(`Credential "${credential.name}" deleted`, 'success');
            fetchCredentials();
        } catch (err) {
            showToast('Failed to delete credential', 'error');
        }
    };

    const handleToggleExport = async (credential) => {
        const newValue = !credential.export_to_agent;

        // Must have at least one mapping before enabling export
        const mappings = credential.env_mappings || {};
        if (newValue && Object.keys(mappings).length === 0) {
            showToast('Add at least one env mapping first', 'error');
            return;
        }

        // Optimistic update
        setCredentials(prev => prev.map(c =>
            c.name === credential.name && c.type === credential.type
                ? { ...c, export_to_agent: newValue }
                : c
        ));

        try {
            const result = await apiClient.updateCredentialMetadata(
                credential.type,
                credential.name,
                { export_to_agent: newValue, project_id: projectId }
            );
            if (result.credential) {
                setCredentials(prev => prev.map(c =>
                    c.name === credential.name && c.type === credential.type
                        ? result.credential
                        : c
                ));
            }
            showToast(`Export ${newValue ? 'enabled' : 'disabled'} for "${credential.name}"`, 'success');
        } catch (err) {
            console.error('Toggle export failed:', err);
            // Rollback optimistic update
            setCredentials(prev => prev.map(c =>
                c.name === credential.name && c.type === credential.type
                    ? { ...c, export_to_agent: !newValue }
                    : c
            ));
            showToast(`Failed: ${err.message || 'Unknown error'}`, 'error');
        }
    };

    const showToast = (message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    // No project selected
    if (!projectId) {
        return (
            <div className="min-h-screen dark:bg-gray-900 p-6">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <KeyIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Select a Project</h3>
                        <p className="text-gray-500 dark:text-gray-400">
                            Choose a project from the sidebar to manage credentials
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen dark:bg-gray-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Credentials</h1>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Securely manage secrets stored in Vault
                            {userRole && !isAdmin && (
                                <span className="ml-2 text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                                    Read-only ({userRole})
                                </span>
                            )}
                        </p>
                    </div>
                    {isAdmin && (
                        <button
                            onClick={() => setShowAddModal(true)}
                            disabled={!vaultAvailable}
                            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <PlusIcon className="h-5 w-5 mr-2" />
                            Add Credential
                        </button>
                    )}
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

                {/* No access */}
                {userRole === null && !loading && (
                    <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <ExclamationTriangleIcon className="h-6 w-6 text-red-600 dark:text-red-400 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-red-900 dark:text-red-100">No Access</p>
                            <p className="text-xs text-red-700 dark:text-red-300">
                                You don&apos;t have access to this project&apos;s credentials.
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
                            {isAdmin
                                ? 'Add credentials to connect to services securely'
                                : 'No credentials have been added to this project yet'}
                        </p>
                        {isAdmin && (
                            <button
                                onClick={() => setShowAddModal(true)}
                                disabled={!vaultAvailable}
                                className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <PlusIcon className="h-5 w-5 mr-2" />
                                Add Your First Credential
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {credentials.map(credential => (
                            <CredentialCard
                                key={`${credential.type}-${credential.name}`}
                                credential={credential}
                                isAdmin={isAdmin}
                                projectId={projectId}
                                onDelete={handleDeleteCredential}
                                onToggleExport={handleToggleExport}
                                onUpdate={(updated) => {
                                    if (updated) {
                                        setCredentials(prev => prev.map(c =>
                                            c.name === updated.name && c.type === updated.type ? updated : c
                                        ));
                                    } else {
                                        fetchCredentials();
                                    }
                                }}
                                showToast={showToast}
                            />
                        ))}
                    </div>
                )}

                {/* Add Modal */}
                {isAdmin && (
                    <AddCredentialModal
                        isOpen={showAddModal}
                        onClose={() => setShowAddModal(false)}
                        projectId={projectId}
                        onSuccess={() => {
                            setShowAddModal(false);
                            fetchCredentials();
                            showToast('Credential added successfully', 'success');
                        }}
                        onError={(msg) => showToast(msg, 'error')}
                    />
                )}

                {/* Toast */}
                {toast && (
                    <div className="fixed bottom-4 right-4 z-50">
                        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${
                            toast.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
                            toast.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                            'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                        }`}>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{toast.message}</span>
                            <button onClick={() => setToast(null)} className="ml-2 text-gray-400 hover:text-gray-600">x</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Credential Card with export toggle and env mappings
const CredentialCard = ({ credential, isAdmin, projectId, onDelete, onToggleExport, onUpdate, showToast }) => {
    const [showMappingEditor, setShowMappingEditor] = useState(false);
    const [mappings, setMappings] = useState({});
    const [newEnvVar, setNewEnvVar] = useState('');
    const [newJsonKey, setNewJsonKey] = useState('');
    const [saving, setSaving] = useState(false);

    const dataKeys = credential.data_keys || [];
    // Display uses prop directly; editor uses local state
    const displayMappings = Object.entries(credential.env_mappings || {});
    const editorMappings = Object.entries(mappings);

    const handleAddMapping = () => {
        if (!newEnvVar.trim() || !newJsonKey.trim()) return;
        setMappings(prev => ({ ...prev, [newEnvVar.trim()]: newJsonKey.trim() }));
        setNewEnvVar('');
        setNewJsonKey('');
    };

    const handleRemoveMapping = (envVar) => {
        setMappings(prev => {
            const next = { ...prev };
            delete next[envVar];
            return next;
        });
    };

    const handleSaveMappings = async () => {
        // Auto-add pending mapping if user typed but didn't click +
        let finalMappings = { ...mappings };
        if (newEnvVar.trim() && newJsonKey.trim()) {
            finalMappings[newEnvVar.trim()] = newJsonKey.trim();
            setMappings(finalMappings);
            setNewEnvVar('');
            setNewJsonKey('');
        }

        if (Object.keys(finalMappings).length === 0) {
            showToast('Add at least one env mapping', 'error');
            return;
        }

        setSaving(true);
        try {
            const result = await apiClient.updateCredentialMetadata(
                credential.type,
                credential.name,
                { env_mappings: finalMappings, project_id: projectId }
            );
            setShowMappingEditor(false);
            showToast('Mappings saved', 'success');
            onUpdate(result.credential);
        } catch (err) {
            showToast('Failed to save mappings', 'error');
        }
        setSaving(false);
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow">
            {/* Header row */}
            <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">{credential.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{credential.type_name}</p>
                </div>
                {isAdmin && (
                    <button
                        onClick={() => onDelete(credential)}
                        className="text-gray-400 hover:text-red-600 transition-colors ml-2 flex-shrink-0"
                    >
                        <TrashIcon className="h-5 w-5" />
                    </button>
                )}
            </div>

            {/* Data keys badge */}
            {dataKeys.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                    {dataKeys.map(k => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded font-mono">
                            {k}
                        </span>
                    ))}
                </div>
            )}

            {/* Env mappings display */}
            <div className="mb-3">
                {displayMappings.length > 0 ? (
                    <div className="space-y-1">
                        {displayMappings.map(([envVar, jsonKey]) => (
                            <div key={envVar} className="text-xs font-mono flex items-center gap-1">
                                <span className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">{envVar}</span>
                                <span className="text-gray-400">&larr;</span>
                                <span className="text-gray-600 dark:text-gray-400">{jsonKey}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-gray-400 italic">No env mappings</p>
                )}
                {isAdmin && (
                    <button
                        onClick={() => {
                            if (!showMappingEditor) {
                                // Sync from prop when opening editor
                                setMappings(credential.env_mappings || {});
                            }
                            setShowMappingEditor(!showMappingEditor);
                        }}
                        className="mt-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        {showMappingEditor ? 'Cancel' : displayMappings.length > 0 ? 'Edit mappings' : '+ Add mappings'}
                    </button>
                )}
            </div>

            {/* Mapping editor (inline) - admin only */}
            {isAdmin && showMappingEditor && (
                <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
                    {/* Existing mappings */}
                    {editorMappings.map(([envVar, jsonKey]) => (
                        <div key={envVar} className="flex items-center gap-1 mb-1 text-xs">
                            <span className="font-mono flex-1 truncate">{envVar}</span>
                            <span className="text-gray-400">&larr;</span>
                            <span className="font-mono text-gray-600 dark:text-gray-400">{jsonKey}</span>
                            <button onClick={() => handleRemoveMapping(envVar)} className="text-red-400 hover:text-red-600 ml-1">x</button>
                        </div>
                    ))}

                    {/* Add new mapping */}
                    <div className="flex items-center gap-1 mt-2">
                        <input
                            value={newEnvVar}
                            onChange={(e) => setNewEnvVar(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                            placeholder="ENV_VAR"
                            className="flex-1 text-xs font-mono px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <span className="text-gray-400 text-xs">&larr;</span>
                        {dataKeys.length > 0 ? (
                            <select
                                value={newJsonKey}
                                onChange={(e) => setNewJsonKey(e.target.value)}
                                className="flex-1 text-xs font-mono px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">key</option>
                                {dataKeys.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                        ) : (
                            <input
                                value={newJsonKey}
                                onChange={(e) => setNewJsonKey(e.target.value)}
                                placeholder="json_key"
                                className="flex-1 text-xs font-mono px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        )}
                        <button
                            onClick={handleAddMapping}
                            disabled={!newEnvVar.trim() || !newJsonKey.trim()}
                            className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-30"
                        >
                            +
                        </button>
                    </div>

                    {/* Save */}
                    <button
                        onClick={handleSaveMappings}
                        disabled={saving}
                        className="mt-2 w-full text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Mappings'}
                    </button>
                </div>
            )}

            {/* Export toggle - admin only can change, viewers see status */}
            <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                {isAdmin ? (
                    <Switch
                        checked={credential.export_to_agent}
                        onChange={(checked) => onToggleExport(credential, checked)}
                        label={"Export to Agent"}
                        size="sm"
                    />
                ) : (
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className={`w-2 h-2 rounded-full ${credential.export_to_agent ? 'bg-green-500' : 'bg-gray-300'}`} />
                        Export to Agent: {credential.export_to_agent ? 'Enabled' : 'Disabled'}
                    </div>
                )}
            </div>
        </div>
    );
};

// Add Credential Modal
const AddCredentialModal = ({ isOpen, onClose, projectId, onSuccess, onError }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [value, setValue] = useState('');
    const [exportToAgent, setExportToAgent] = useState(false);
    const [envMappings, setEnvMappings] = useState({});
    const [newEnvVar, setNewEnvVar] = useState('');
    const [newJsonKey, setNewJsonKey] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Detect JSON keys from value input
    const detectedKeys = (() => {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return Object.keys(parsed);
            }
        } catch { /* not JSON */ }
        return value.trim() ? ['value'] : [];
    })();

    const handleAddMapping = () => {
        if (!newEnvVar.trim() || !newJsonKey.trim()) return;
        setEnvMappings(prev => ({ ...prev, [newEnvVar.trim()]: newJsonKey.trim() }));
        setNewEnvVar('');
        setNewJsonKey('');
    };

    const handleRemoveMapping = (envVar) => {
        setEnvMappings(prev => {
            const next = { ...prev };
            delete next[envVar];
            return next;
        });
    };

    const handleSubmit = async () => {
        if (!name.trim() || !value.trim()) return;
        if (exportToAgent && Object.keys(envMappings).length === 0) {
            onError('Add at least one env mapping when export is enabled');
            return;
        }
        setSubmitting(true);

        // Parse value: if valid JSON object, store as-is; otherwise wrap in {value: ...}
        let dataPayload;
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                dataPayload = parsed;
            } else {
                dataPayload = { value };
            }
        } catch {
            dataPayload = { value };
        }

        try {
            await apiClient.storeCredential({
                credential_type: 'generic_api_key',
                credential_name: name.trim(),
                project_id: projectId,
                description: description.trim(),
                data: dataPayload,
                export_to_agent: exportToAgent,
                env_mappings: Object.keys(envMappings).length > 0 ? envMappings : undefined,
            });
            setName('');
            setDescription('');
            setValue('');
            setExportToAgent(false);
            setEnvMappings({});
            onSuccess();
        } catch (err) {
            onError(err.message || 'Failed to add credential');
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
                    placeholder="e.g., opensearch_creds"
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
                    placeholder={'Plain text: my-api-key-xxx\nOr JSON: {"username": "admin", "password": "secret"}'}
                    rows={5}
                    className="font-mono"
                    helperText="Stored encrypted in Vault. JSON objects will have their keys available for env mapping."
                />

                {/* Detected keys preview */}
                {detectedKeys.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Keys:</span>
                        {detectedKeys.map(k => (
                            <span key={k} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded font-mono">
                                {k}
                            </span>
                        ))}
                    </div>
                )}

                {/* Export Settings */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <Switch
                        checked={exportToAgent}
                        onChange={setExportToAgent}
                        label="Export to AI Agent"
                        description="Make this credential available as environment variables"
                        className="mb-3"
                    />

                    {exportToAgent && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                Env Mappings (ENV_VAR &larr; json_key)
                            </label>

                            {/* Existing mappings */}
                            {Object.entries(envMappings).map(([envVar, jsonKey]) => (
                                <div key={envVar} className="flex items-center gap-1 text-xs">
                                    <span className="font-mono px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">{envVar}</span>
                                    <span className="text-gray-400">&larr;</span>
                                    <span className="font-mono text-gray-600 dark:text-gray-400">{jsonKey}</span>
                                    <button onClick={() => handleRemoveMapping(envVar)} className="text-red-400 hover:text-red-600 ml-1">x</button>
                                </div>
                            ))}

                            {/* Add new mapping */}
                            <div className="flex items-center gap-1">
                                <input
                                    value={newEnvVar}
                                    onChange={(e) => setNewEnvVar(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                                    placeholder="ENV_VAR_NAME"
                                    className="flex-1 text-xs font-mono px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddMapping(); }}
                                />
                                <span className="text-gray-400 text-xs">&larr;</span>
                                {detectedKeys.length > 1 ? (
                                    <select
                                        value={newJsonKey}
                                        onChange={(e) => setNewJsonKey(e.target.value)}
                                        className="flex-1 text-xs font-mono px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        <option value="">Select key</option>
                                        {detectedKeys.map(k => <option key={k} value={k}>{k}</option>)}
                                    </select>
                                ) : (
                                    <input
                                        value={newJsonKey}
                                        onChange={(e) => setNewJsonKey(e.target.value)}
                                        placeholder={detectedKeys[0] || 'json_key'}
                                        className="flex-1 text-xs font-mono px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddMapping(); }}
                                    />
                                )}
                                <button
                                    onClick={handleAddMapping}
                                    disabled={!newEnvVar.trim() || !newJsonKey.trim()}
                                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-30"
                                >
                                    +
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

export default CredentialsPage;
