'use client';

import { useState, useEffect } from 'react';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';
import Input from '../ui/Input';
import { Menu, MenuButton, MenuItems, MenuItem, Transition } from '@headlessui/react';

/**
 * TokenModal - Modal for adding/editing API tokens
 */
export default function TokenModal({ 
  isOpen, 
  onClose, 
  onSave, 
  mode = 'create',
  initialData = null
}) {
  const [formData, setFormData] = useState({
    name: '',
    token: '',
    provider: 'gemini'
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const providers = [
    { id: 'gemini', name: 'Google Gemini', icon: '🔮' },
    { id: 'openai', name: 'OpenAI', icon: '🤖' },
    { id: 'anthropic', name: 'Anthropic Claude', icon: '🎭' },
    { id: 'other', name: 'Other', icon: '🔧' }
  ];

  // Load initial data when editing
  useEffect(() => {
    if (mode === 'edit' && initialData) {
      setFormData({
        name: initialData.name || '',
        token: initialData.token || '',
        provider: initialData.provider || 'gemini'
      });
    } else {
      setFormData({
        name: '',
        token: '',
        provider: 'gemini'
      });
    }
    setErrors({});
  }, [mode, initialData, isOpen]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Token name is required';
    }

    if (!formData.token.trim()) {
      newErrors.token = 'API token is required';
    } else if (formData.token.trim().length < 10) {
      newErrors.token = 'Token appears to be too short';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      await onSave(formData);
      // Reset form and close
      setFormData({ name: '', token: '', provider: 'gemini' });
      setErrors({});
      onClose();
    } catch (error) {
      setErrors({ submit: error.message || 'Failed to save token' });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const selectedProvider = providers.find(p => p.id === formData.provider) || providers[0];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? 'Add API Token' : 'Edit API Token'}
      size="lg"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </ModalButton>
          <ModalButton 
            variant="primary" 
            onClick={handleSubmit}
            loading={loading}
          >
            {mode === 'create' ? 'Add Token' : 'Save Changes'}
          </ModalButton>
        </ModalFooter>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Provider Selection */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Provider <span className="text-red-500">*</span>
          </label>
          <Menu as="div" className="relative">
            <MenuButton className="w-full flex items-center justify-between rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm py-3 px-4 text-sm text-gray-900 dark:text-white focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500 transition-colors">
              <span className="flex items-center gap-2">
                <span className="text-lg">{selectedProvider.icon}</span>
                <span>{selectedProvider.name}</span>
              </span>
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </MenuButton>

            <Transition
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
            >
              <MenuItems className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 max-h-60 overflow-auto">
                {providers.map((provider) => (
                  <MenuItem key={provider.id}>
                    {({ focus }) => (
                      <button
                        type="button"
                        onClick={() => handleChange('provider', provider.id)}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                          focus ? 'bg-blue-50 dark:bg-blue-900/20 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
                        } ${formData.provider === provider.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      >
                        <span className="text-lg">{provider.icon}</span>
                        <span>{provider.name}</span>
                        {formData.provider === provider.id && (
                          <span className="ml-auto text-blue-600 dark:text-blue-400">✓</span>
                        )}
                      </button>
                    )}
                  </MenuItem>
                ))}
              </MenuItems>
            </Transition>
          </Menu>
        </div>

        {/* Token Name */}
        <Input
          label="Token Name"
          placeholder="e.g., My Gemini API Key"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          required
          error={errors.name}
          helperText="A friendly name to identify this token"
        />

        {/* API Token */}
        <Input
          label="API Token"
          type="password"
          placeholder="Enter your API token"
          value={formData.token}
          onChange={(e) => handleChange('token', e.target.value)}
          required
          error={errors.token}
          helperText="Your API key will be stored securely"
        />

        {/* Provider-specific help text */}
        {formData.provider === 'gemini' && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              💡 <strong>Get your Gemini API key:</strong>{' '}
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline hover:text-blue-600 dark:hover:text-blue-200"
              >
                Visit Google AI Studio
              </a>
            </p>
          </div>
        )}

        {/* Submit Error */}
        {errors.submit && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">
              {errors.submit}
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}

