'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import apiClient from '@/lib/api';

const EFFECT_LABELS = {
  allow: { label: 'ALLOW', className: 'bg-green-100 text-green-800' },
  deny:  { label: 'DENY',  className: 'bg-red-100 text-red-800' },
};

const PRINCIPAL_TYPE_LABELS = {
  role: 'Role',
  user: 'User',
  '*':  'Everyone',
};

const DEFAULT_FORM = {
  name: '',
  description: '',
  effect: 'deny',
  principal_type: 'role',
  principal_value: '',
  tool_pattern: '*',
  priority: 0,
  project_id: '',
};

function PolicyModal({ open, onClose, onSave, initial, orgId, currentProject }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(initial
        ? {
            name: initial.name || '',
            description: initial.description || '',
            effect: initial.effect || 'deny',
            principal_type: initial.principal_type || 'role',
            principal_value: initial.principal_value || '',
            tool_pattern: initial.tool_pattern || '*',
            priority: initial.priority ?? 0,
            project_id: initial.project_id || '',
          }
        : { ...DEFAULT_FORM, project_id: currentProject?.id || '' }
      );
      setError('');
    }
  }, [open, initial, currentProject]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        org_id: orgId,
        name: form.name,
        effect: form.effect,
        principal_type: form.principal_type,
        tool_pattern: form.tool_pattern,
        priority: parseInt(form.priority, 10) || 0,
        ...(form.description && { description: form.description }),
        ...(form.project_id && { project_id: form.project_id }),
        ...(form.principal_type !== '*' && form.principal_value && { principal_value: form.principal_value }),
      };
      await onSave(payload, initial?.id);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold mb-4">
          {initial ? 'Edit Policy' : 'Create Policy'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              placeholder="deny-bash-viewers"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effect *</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.effect}
                onChange={e => setForm(f => ({ ...f, effect: e.target.value }))}
              >
                <option value="deny">DENY</option>
                <option value="allow">ALLOW</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Principal Type *</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.principal_type}
                onChange={e => setForm(f => ({ ...f, principal_type: e.target.value, principal_value: '' }))}
              >
                <option value="role">Role</option>
                <option value="user">User ID</option>
                <option value="*">Everyone (*)</option>
              </select>
            </div>
            {form.principal_type !== '*' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {form.principal_type === 'role' ? 'Role' : 'User ID'} *
                </label>
                {form.principal_type === 'role' ? (
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={form.principal_value}
                    onChange={e => setForm(f => ({ ...f, principal_value: e.target.value }))}
                  >
                    <option value="">Select role…</option>
                    <option value="viewer">viewer</option>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                ) : (
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={form.principal_value}
                    onChange={e => setForm(f => ({ ...f, principal_value: e.target.value }))}
                    placeholder="user UUID"
                  />
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tool Pattern *</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm font-mono"
              value={form.tool_pattern}
              onChange={e => setForm(f => ({ ...f, tool_pattern: e.target.value }))}
              required
              placeholder="mcp__bash__* or exact_tool_name or *"
            />
            <p className="text-xs text-gray-500 mt-1">fnmatch glob — e.g. <code>mcp__bash__*</code> matches all bash tools</p>
          </div>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : (initial ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PoliciesPage() {
  const { currentOrg, currentProject } = useOrg();

  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchPolicies = useCallback(async () => {
    if (!currentOrg?.id) return;
    setLoading(true);
    try {
      const data = await apiClient.getPolicies({
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id }),
      });
      setPolicies(data.policies || []);
    } catch (err) {
      console.error('Failed to fetch policies:', err);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?.id, currentProject?.id]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleSave = async (payload, id) => {
    if (id) {
      await apiClient.updatePolicy(id, payload, currentOrg.id);
    } else {
      await apiClient.createPolicy(payload);
    }
    await fetchPolicies();
  };

  const handleToggleActive = async (policy) => {
    await apiClient.updatePolicy(policy.id, { is_active: !policy.is_active }, currentOrg.id);
    await fetchPolicies();
  };

  const handleDelete = async (id) => {
    await apiClient.deletePolicy(id, currentOrg.id);
    setDeleteConfirm(null);
    await fetchPolicies();
  };

  const openCreate = () => {
    setEditingPolicy(null);
    setModalOpen(true);
  };

  const openEdit = (policy) => {
    setEditingPolicy(policy);
    setModalOpen(true);
  };

  if (!currentOrg?.id) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Please select an organization to manage policies.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent Policies</h1>
          <p className="text-sm text-gray-500 mt-1">
            Declarative tool access control — define allow/deny rules by role without user prompts.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          + Create Policy
        </button>
      </div>

      {/* Policy Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading policies…</div>
      ) : policies.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium mb-2">No policies</p>
          <p className="text-sm">Create a policy to control AI tool access without user prompts.</p>
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Effect', 'Principal', 'Tool Pattern', 'Priority', 'Scope', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {policies.map(policy => {
                const effect = EFFECT_LABELS[policy.effect] || { label: policy.effect, className: 'bg-gray-100 text-gray-700' };
                const principalLabel = PRINCIPAL_TYPE_LABELS[policy.principal_type] || policy.principal_type;
                const principalDisplay = policy.principal_type === '*'
                  ? 'Everyone'
                  : `${principalLabel}: ${policy.principal_value || '—'}`;
                const scope = policy.project_id ? 'Project' : 'Org-wide';
                return (
                  <tr key={policy.id} className={policy.is_active ? '' : 'opacity-50'}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {policy.name}
                      {policy.description && (
                        <p className="text-xs text-gray-400 font-normal truncate max-w-xs">{policy.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${effect.className}`}>
                        {effect.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{principalDisplay}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-800">{policy.tool_pattern}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{policy.priority}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{scope}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(policy)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          policy.is_active ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                        title={policy.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          policy.is_active ? 'translate-x-5' : 'translate-x-1'
                        }`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(policy)}
                          className="text-blue-600 hover:text-blue-800 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(policy)}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <PolicyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initial={editingPolicy}
        orgId={currentOrg?.id}
        currentProject={currentProject}
      />

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold mb-2">Delete Policy</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
