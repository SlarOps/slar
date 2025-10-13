'use client';

import { useState, useEffect } from 'react';
import { toast, ConfirmationModal } from '../../components/ui';
import APITokenCard from '../../components/integrations/APITokenCard';
import TokenModal from '../../components/integrations/TokenModal';

export default function IntegrationsPage() {
  // Token states
  const [tokens, setTokens] = useState([]);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenModalMode, setTokenModalMode] = useState('create');
  const [selectedToken, setSelectedToken] = useState(null);
  const [tokenToDelete, setTokenToDelete] = useState(null);
  const [showTokenDeleteModal, setShowTokenDeleteModal] = useState(false);

  useEffect(() => {
    loadTokens();
  }, []);

  // Token management functions
  const loadTokens = () => {
    // Load tokens from localStorage (or from API if you implement backend)
    try {
      const storedTokens = localStorage.getItem('api_tokens');
      if (storedTokens) {
        setTokens(JSON.parse(storedTokens));
      }
    } catch (error) {
      console.error('Failed to load tokens:', error);
    }
  };

  const saveTokensToStorage = (updatedTokens) => {
    localStorage.setItem('api_tokens', JSON.stringify(updatedTokens));
    setTokens(updatedTokens);
  };

  const handleCreateToken = () => {
    setTokenModalMode('create');
    setSelectedToken(null);
    setShowTokenModal(true);
  };

  const handleEditToken = (token) => {
    setTokenModalMode('edit');
    setSelectedToken(token);
    setShowTokenModal(true);
  };

  const handleDeleteToken = (token) => {
    setTokenToDelete(token);
    setShowTokenDeleteModal(true);
  };

  const confirmDeleteToken = () => {
    if (!tokenToDelete) return;

    const updatedTokens = tokens.filter(t => t.id !== tokenToDelete.id);
    saveTokensToStorage(updatedTokens);
    
    toast.success('Token deleted successfully');
    setShowTokenDeleteModal(false);
    setTokenToDelete(null);
  };

  const handleToggleToken = (tokenId) => {
    const updatedTokens = tokens.map(t => 
      t.id === tokenId ? { ...t, isActive: !t.isActive } : t
    );
    saveTokensToStorage(updatedTokens);
    toast.success('Token status updated');
  };

  const handleSaveToken = async (formData) => {
    if (tokenModalMode === 'create') {
      const newToken = {
        id: Date.now().toString(),
        ...formData,
        isActive: true,
        createdAt: new Date().toISOString(),
        lastUsed: null
      };
      
      const updatedTokens = [...tokens, newToken];
      saveTokensToStorage(updatedTokens);
      
      // Set GEMINI_API_KEY to environment if it's a Gemini token
      if (formData.provider === 'gemini') {
        // Note: This will be used by the terminal session
        sessionStorage.setItem('GEMINI_API_KEY', formData.token);
      }
      
      toast.success('Token added successfully');
    } else {
      const updatedTokens = tokens.map(t => 
        t.id === selectedToken.id ? { ...selectedToken, ...formData } : t
      );
      saveTokensToStorage(updatedTokens);
      
      // Update GEMINI_API_KEY if needed
      if (formData.provider === 'gemini') {
        sessionStorage.setItem('GEMINI_API_KEY', formData.token);
      }
      
      toast.success('Token updated successfully');
    }
  };


  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            API Token Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your API tokens for AI services and integrations
          </p>
        </div>
        
        <button 
          onClick={handleCreateToken}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Token
        </button>
      </div>

      {/* Content */}
      <>
        {/* Info Banner */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex gap-3">
            <svg className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                API Token Management
              </h3>
              <p className="text-sm text-blue-800 dark:text-blue-300">
                Store your API tokens securely to use with the AI terminal and other features. 
                Your Gemini API key is used to power the terminal's AI capabilities.
              </p>
            </div>
          </div>
        </div>

        {/* Tokens Grid */}
        {tokens.length === 0 ? (
          <div className="text-center py-12">
            <svg className="mx-auto h-24 w-24 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              No API tokens configured
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Add your first API token to enable AI-powered features in the terminal.
            </p>
            <button 
              onClick={handleCreateToken}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Your First Token
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tokens.map((token) => (
              <APITokenCard
                key={token.id}
                name={token.name}
                token={token.token}
                provider={token.provider}
                isActive={token.isActive}
                createdAt={token.createdAt}
                lastUsed={token.lastUsed}
                onEdit={() => handleEditToken(token)}
                onDelete={() => handleDeleteToken(token)}
                onToggle={() => handleToggleToken(token.id)}
              />
            ))}
          </div>
        )}
      </>

      {/* Token Modal */}
      <TokenModal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        onSave={handleSaveToken}
        mode={tokenModalMode}
        initialData={selectedToken}
      />

      {/* Token Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={showTokenDeleteModal}
        onClose={() => setShowTokenDeleteModal(false)}
        onConfirm={confirmDeleteToken}
        title="Delete API Token"
        message={`Are you sure you want to delete "${tokenToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete Token"
        confirmVariant="danger"
      />
    </div>
  );
}