'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';

export default function EscalationPolicySelector({ 
  groupId, 
  selectedPolicyId, 
  onSelect, 
  showQuickCreate = false,
  onQuickCreate = null,
  required = false,
  disabled = false 
}) {
  const { session } = useAuth();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (groupId && session?.access_token) {
      fetchPolicies();
    }
  }, [groupId, session]);

  const fetchPolicies = async () => {
    setLoading(true);
    setError(null);
    try {
      apiClient.setToken(session.access_token);
      const response = await apiClient.getGroupEscalationPolicies(groupId);
      setPolicies(response.policies || []);
    } catch (error) {
      console.error('Failed to fetch escalation policies:', error);
      setError('Failed to load escalation policies');
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  };

  const activePolicies = policies.filter(policy => policy.is_active);
  const selectedPolicy = policies.find(policy => policy.id === selectedPolicyId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Escalation Policy {required && <span className="text-red-500">*</span>}
        </label>
        {showQuickCreate && onQuickCreate && (
          <button
            type="button"
            onClick={onQuickCreate}
            disabled={disabled}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 disabled:opacity-50"
          >
            + Create New Policy
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center py-2 text-sm text-gray-500 dark:text-gray-400">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
          Loading policies...
        </div>
      ) : error ? (
        <div className="text-sm text-red-600 dark:text-red-400">
          {error}
          <button
            onClick={fetchPolicies}
            className="ml-2 text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"
          >
            Retry
          </button>
        </div>
      ) : (
        <div>
          <Menu>
            <MenuButton 
              disabled={disabled}
              className={`inline-flex w-full justify-between items-center rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm px-4 py-3 text-sm text-gray-900 dark:text-white data-hover:bg-gray-100 dark:data-hover:bg-gray-600 data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-blue-500 data-focus:bg-white dark:data-focus:bg-gray-600 ${
                disabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <span className={selectedPolicyId ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>
                {selectedPolicy ? selectedPolicy.name : (
                  activePolicies.length === 0 ? 'No escalation policies available' : 'Select escalation policy'
                )}
              </span>
              <ChevronDownIcon className="h-5 w-5 text-gray-400" />
            </MenuButton>
            
            <MenuItems
              transition
              anchor="bottom start"
              className="w-64 origin-top-left rounded-lg bg-white/90 dark:bg-gray-700/90 backdrop-blur-sm shadow-lg p-1 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0 z-50"
            >
              {/* Clear selection option */}
              {selectedPolicyId && (
                <MenuItem>
                  <button
                    onClick={() => onSelect(null)}
                    className="group flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400 data-focus:bg-gray-100 dark:data-focus:bg-gray-600 italic"
                  >
                    Clear selection
                  </button>
                </MenuItem>
              )}
              
              {/* Policy options */}
              {activePolicies.length > 0 ? (
                activePolicies.map((policy) => (
                  <MenuItem key={policy.id}>
                    <button
                      onClick={() => onSelect(policy.id)}
                      className={`group flex w-full items-start rounded-lg px-3 py-2 text-sm data-focus:bg-blue-100 dark:data-focus:bg-blue-900 ${
                        selectedPolicyId === policy.id 
                          ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-300' 
                          : 'text-gray-700 dark:text-gray-200'
                      }`}
                    >
                      <div className="text-left">
                        <div className="font-medium">{policy.name}</div>
                        {policy.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {policy.description}
                          </div>
                        )}
                        <div className="flex items-center space-x-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                          <span>{policy.max_escalation_levels || 3} levels</span>
                          <span>{Math.floor((policy.escalation_timeout || 300) / 60)}min timeout</span>
                          {policy.services_count > 0 && (
                            <span>{policy.services_count} services</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </MenuItem>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  No escalation policies available
                </div>
              )}
            </MenuItems>
          </Menu>

          {/* Selected Policy Summary */}
          {selectedPolicy && (
            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm">
                  <div className="font-medium text-blue-700 dark:text-blue-300">
                    {selectedPolicy.name} selected
                  </div>
                  <div className="text-blue-600 dark:text-blue-400 text-xs">
                    {selectedPolicy.max_escalation_levels || 3} levels • {Math.floor((selectedPolicy.escalation_timeout || 300) / 60)}min timeout
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Help Text */}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {activePolicies.length === 0 
              ? 'Create an escalation policy first in the Escalation tab'
              : 'This policy will determine how alerts for this service are escalated'
            }
          </p>
        </div>
      )}
    </div>
  );
}
