'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Toast, toast } from '../ui';
import { Dialog, DialogPanel, DialogTitle, Menu, MenuButton, MenuItems, MenuItem, Transition, TransitionChild, Switch, Field, Label, Input } from '@headlessui/react';
import { ChevronDownIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { Fragment } from 'react';

export default function EscalationPolicyModal({ 
  isOpen, 
  onClose, 
  groupId, 
  members = [], 
  onPolicyCreated, 
  onPolicyUpdated,
  policyID,
  // Edit mode props
  editPolicy = null  // If provided, modal is in edit mode
}) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingPolicyDetail, setLoadingPolicyDetail] = useState(false);

  const isEditMode = !!editPolicy;

  // Policy data
  const [policyData, setPolicyData] = useState({
    name: '',
    escalate_after_minutes: 5,
    repeat_max_times: 1,
    is_active: true
  });

  // Escalation steps - each step has its own targets, search type, and timeout
  const [escalationSteps, setEscalationSteps] = useState([
    {
      id: 'step-1',
      stepNumber: 1,
      targetSearchType: 'Round-robin between targets',
      targets: [],
      escalateAfterMinutes: 5
    }
  ]);

  const [schedulers, setSchedulers] = useState([]);

  // Fetch schedulers when modal opens
  const fetchSchedulers = async () => {
    if (!session?.access_token || !groupId) {
      return;
    }

    try {
      apiClient.setToken(session.access_token);
      const schedulersData = await apiClient.getGroupSchedulers(groupId);
      setSchedulers(schedulersData.schedulers || []);
    } catch (error) {
      console.error('Failed to fetch schedulers:', error);
      setSchedulers([]);
    }
  };

  // Fetch detailed policy data when in edit mode
  const fetchPolicyDetail = async (policyId) => {
    if (!session?.access_token || !groupId || !policyId || policyId.trim() === '') {
      console.log('Skipping policy detail fetch - missing required parameters:', {
        hasToken: !!session?.access_token,
        groupId,
        policyId,
        policyIdTrimmed: policyId?.trim()
      });
      return null;
    }

    setLoadingPolicyDetail(true);
    try {
      apiClient.setToken(session.access_token);
      const policyDetail = await apiClient.getEscalationPolicyDetail(groupId, policyId);
      return policyDetail;
    } catch (error) {
      console.error('Failed to fetch policy detail:', error);
      toast.error('Failed to load policy details');
      return null;
    } finally {
      setLoadingPolicyDetail(false);
    }
  };

  // Reset form when modal opens/closes or edit policy changes
  useEffect(() => {
    console.log('policyID', policyID);
    if (isOpen) {
      // Fetch schedulers when modal opens
      fetchSchedulers();
      
      if (isEditMode && policyID && policyID.trim() !== '') {
        // Fetch detailed policy data using the new endpoint
        fetchPolicyDetail(policyID).then(policyDetail => {
          if (policyDetail) {
            // Populate form with detailed policy data
            setPolicyData({
              name: policyDetail.name || '',
              escalate_after_minutes: policyDetail.escalate_after_minutes || 5,
              repeat_max_times: policyDetail.repeat_max_times || 1,
              is_active: policyDetail.is_active !== undefined ? policyDetail.is_active : true
            });
            
            // Check if backend returned grouped steps or individual levels
            if (policyDetail.steps && policyDetail.steps.length > 0) {
              // New format: Backend already grouped levels into steps
              const steps = policyDetail.steps.map(step => ({
                id: `step-${step.stepNumber}`,
                stepNumber: step.stepNumber,
                targetSearchType: 'Round-robin between targets',
                targets: step.targets.map((target, targetIndex) => ({
                  id: `target-${step.stepNumber}-${targetIndex}`,
                  type: target.type,
                  target_id: target.target_id,
                  name: target.name || target.type,
                  responder: target.name || target.description || 'None'
                })),
                escalateAfterMinutes: step.escalateAfterMinutes || policyDetail.escalate_after_minutes || 5
              }));
              setEscalationSteps(steps);
            } else if (policyDetail.levels && policyDetail.levels.length > 0) {
              // Legacy format: Group levels by step number
              const levelsByStep = {};
              policyDetail.levels.forEach(level => {
                const stepNumber = level.level_number;
                if (!levelsByStep[stepNumber]) {
                  levelsByStep[stepNumber] = [];
                }
                levelsByStep[stepNumber].push(level);
              });

              const steps = Object.keys(levelsByStep)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(stepNumber => ({
                  id: `step-${stepNumber}`,
                  stepNumber: parseInt(stepNumber),
                  targetSearchType: 'Round-robin between targets',
                  targets: levelsByStep[stepNumber].map((level, targetIndex) => ({
                    id: level.id || `target-${stepNumber}-${targetIndex}`,
                    type: level.target_type,
                    target_id: level.target_id,
                    name: level.target_name || getTargetDisplayName(level),
                    responder: level.target_name || level.target_description || 'None'
                  })),
                  escalateAfterMinutes: levelsByStep[stepNumber][0]?.timeout_minutes || policyDetail.escalate_after_minutes || 5
                }));
              setEscalationSteps(steps);
            }
          }
        });
      } else if (isEditMode && editPolicy) {
        // Fallback to using editPolicy prop if policyID is not available
        setPolicyData({
          name: editPolicy.name || '',
          escalate_after_minutes: editPolicy.escalate_after_minutes || 5,
          repeat_max_times: editPolicy.repeat_max_times || 1,
          is_active: editPolicy.is_active !== undefined ? editPolicy.is_active : true
        });
        
        // Load existing escalation steps from levels
        if (editPolicy.levels && editPolicy.levels.length > 0) {
          const steps = editPolicy.levels.map((level, index) => ({
            id: `step-${level.level_number || index + 1}`,
            stepNumber: level.level_number || index + 1,
            targetSearchType: 'Round-robin between targets', // Default, could be stored in policy
            targets: [{
              id: level.id || `target-${index}`,
              type: level.target_type,
              target_id: level.target_id,
              name: level.target_name || getTargetDisplayName(level),
              responder: level.target_name || 'None'
            }],
            escalateAfterMinutes: level.timeout_minutes || editPolicy.escalate_after_minutes || 5
          }));
          setEscalationSteps(steps);
        }
      } else {
        // Reset to create mode defaults
        setPolicyData({
          name: '',
          escalate_after_minutes: 5,
          repeat_max_times: 1,
          is_active: true
        });
        setEscalationSteps([
          {
            id: 'step-1',
            stepNumber: 1,
            targetSearchType: 'Round-robin between targets',
            targets: [],
            escalateAfterMinutes: 5
          }
        ]);
      }
    }
  }, [isOpen, isEditMode, editPolicy, policyID]);

  const getTargetDisplayName = (level) => {
    if (level.target_type === 'schedule') {
      return level.target_name || 'Schedule';
    }
    return level.target_name || level.target_id;
  };

  // Step management functions
  const addEscalationStep = () => {
    const newStep = {
      id: `step-${Date.now()}`,
      stepNumber: escalationSteps.length + 1,
      targetSearchType: 'Round-robin between targets',
      targets: [],
      escalateAfterMinutes: policyData.escalate_after_minutes
    };
    setEscalationSteps(prev => [...prev, newStep]);
  };

  const removeEscalationStep = (stepId) => {
    if (escalationSteps.length <= 1) {
      toast.warning('At least one escalation step is required');
      return;
    }
    setEscalationSteps(prev => {
      const filtered = prev.filter(step => step.id !== stepId);
      // Renumber steps
      return filtered.map((step, index) => ({
        ...step,
        stepNumber: index + 1
      }));
    });
  };

  const updateStepTargetSearchType = (stepId, searchType) => {
    setEscalationSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, targetSearchType: searchType } : step
    ));
  };

  const updateStepTimeout = (stepId, timeout) => {
    setEscalationSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, escalateAfterMinutes: timeout } : step
    ));
  };

  const addTargetToStep = (stepId, targetType, targetId, targetName) => {
    const newTarget = {
      id: `target-${Date.now()}`,
      type: targetType,
      target_id: targetId,
      name: targetName,
      responder: targetType === 'scheduler' ? targetName : 'None'
    };
    
    setEscalationSteps(prev => prev.map(step => 
      step.id === stepId ? { 
        ...step, 
        targets: [...step.targets, newTarget] 
      } : step
    ));
  };

  const removeTargetFromStep = (stepId, targetId) => {
    setEscalationSteps(prev => prev.map(step => 
      step.id === stepId ? { 
        ...step, 
        targets: step.targets.filter(t => t.id !== targetId) 
      } : step
    ));
  };

  const addSchedulerTargetToStep = (stepId, schedulerId, schedulerName) => {
    const step = escalationSteps.find(s => s.id === stepId);
    if (!step) return;

    const existingTarget = step.targets.find(target => target.target_id === schedulerId);
    if (existingTarget) {
      toast.warning('Scheduler already added to this step');
      return;
    }
    addTargetToStep(stepId, 'scheduler', schedulerId, schedulerName);
  };



  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!policyData.name.trim()) {
      toast.error('Policy name is required');
      return;
    }
    
    // Validate that each step has at least one target
    const stepsWithoutTargets = escalationSteps.filter(step => step.targets.length === 0);
    if (stepsWithoutTargets.length > 0) {
      toast.error(`Step ${stepsWithoutTargets[0].stepNumber} requires at least one target`);
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);
      
      // Convert escalation steps to API format
      const levels = [];
      escalationSteps.forEach((step, stepIndex) => {
        step.targets.forEach((target, targetIndex) => {
          levels.push({
            level_number: stepIndex + 1,
            target_type: target.type,
            target_id: target.target_id,
            timeout_minutes: step.escalateAfterMinutes,
            notification_methods: ['email'],
            message_template: `Alert requires attention - Step ${step.stepNumber}`
          });
        });
      });

      const requestData = {
        name: policyData.name,
        repeat_max_times: policyData.repeat_max_times,
        escalate_after_minutes: policyData.escalate_after_minutes,
        levels: levels
      };

      let response;
      if (isEditMode) {
        // Update existing policy
        response = await apiClient.updateEscalationPolicy(groupId, editPolicy.id, requestData);
        onPolicyUpdated && onPolicyUpdated(response.policy);
        toast.success('Escalation policy updated successfully!');
      } else {
        // Create new policy
        response = await apiClient.createEscalationPolicy(groupId, requestData);
        onPolicyCreated && onPolicyCreated(response.policy);
        toast.success('Escalation policy created successfully!');
      }

      onClose();
    } catch (error) {
      console.error(`Failed to ${isEditMode ? 'update' : 'create'} escalation policy:`, error);
      toast.error(`Failed to ${isEditMode ? 'update' : 'create'} escalation policy`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 p-6 text-left align-middle transition-all shadow-2xl dark:shadow-gray-900/50">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <DialogTitle as="h3" className="text-xl font-semibold leading-6 text-gray-900 dark:text-white">
                    {isEditMode ? 'Edit Escalation Policy' : 'Create Escalation Policy'}
                  </DialogTitle>
                  <button
                    type="button"
                    className="rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-2 transition-colors duration-200"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

        {/* Content - Scrollable */}
        <div className="overflow-y-auto flex-1 max-h-[calc(90vh-180px)]">
          {loadingPolicyDetail ? (
            <div className="flex items-center justify-center p-8">
              <div className="flex items-center space-x-3">
                <svg className="animate-spin h-6 w-6 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-gray-600 dark:text-gray-400">Loading policy details...</span>
              </div>
            </div>
          ) : (
          <div className="p-6 space-y-6">
          {/* Active Status - Only show in edit mode */}
          {isEditMode && (
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-900 dark:text-white">Policy Status</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {policyData.is_active ? 'Policy is currently active' : 'Policy is currently inactive'}
                </span>
              </div>
              <Switch
                checked={policyData.is_active}
                onChange={(checked) => setPolicyData(prev => ({ ...prev, is_active: checked }))}
                className={`${
                  policyData.is_active ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
              >
                <span className="sr-only">Enable policy</span>
                <span
                  className={`${
                    policyData.is_active ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </Switch>
            </div>
          )}

          {/* Policy Name */}
          <Field>
            <Label className="text-sm font-medium text-gray-900 dark:text-white">
              Policy Name *
            </Label>
            <Input
              type="text"
              value={policyData.name}
              onChange={(e) => setPolicyData(prev => ({ ...prev, name: e.target.value }))}
              className="mt-2 block w-full rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm py-3 px-4 text-sm text-gray-900 dark:text-white data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-blue-500 data-focus:bg-white dark:data-focus:bg-gray-600"
              placeholder="e.g., Critical Apps Policy"
            />
          </Field>

          {/* Escalation Steps */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-medium text-gray-900 dark:text-white">Escalation Steps</h4>
              <button
                type="button"
                onClick={addEscalationStep}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Step
              </button>
            </div>

            {escalationSteps.map((step, stepIndex) => (
              <div key={step.id} className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 space-y-4">
                {/* Step Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                      <span className="text-sm font-semibold text-blue-600 dark:text-blue-300">{step.stepNumber}</span>
                    </div>
                    <h5 className="text-md font-medium text-gray-900 dark:text-white">
                      Step {step.stepNumber}
                    </h5>
                  </div>
                  {escalationSteps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEscalationStep(step.id)}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Target Search Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Notification Strategy
                  </label>
                  <Menu>
                    <MenuButton className="inline-flex w-full justify-between items-center rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm px-4 py-3 text-sm text-gray-900 dark:text-white data-hover:bg-gray-100 dark:data-hover:bg-gray-600 data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-blue-500 data-focus:bg-white dark:data-focus:bg-gray-600">
                      {step.targetSearchType}
                      <ChevronDownIcon className="h-5 w-5 text-gray-400" />
                    </MenuButton>
                    <MenuItems
                      transition
                      anchor="bottom start"
                      className="w-64 origin-top-left rounded-lg bg-white/90 dark:bg-gray-700/90 backdrop-blur-sm shadow-lg p-1 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
                    >
                      {[
                        "🔄 Round-robin between targets",
                        "📢 Notify all targets", 
                        "⚡ First available"
                      ].map((option) => (
                        <MenuItem key={option}>
                          <button
                            onClick={() => updateStepTargetSearchType(step.id, option)}
                            className="group flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 data-focus:bg-blue-100 dark:data-focus:bg-blue-900"
                          >
                            {option}
                          </button>
                        </MenuItem>
                      ))}
                    </MenuItems>
                  </Menu>
                </div>

                {/* Add Target Section */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Targets
                  </label>
                  <div className="flex gap-2 mb-3">
                    <div className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-md text-sm font-medium flex items-center">
                      Add target
                    </div>
                    <div className="flex-1">
                      <Menu>
                        <MenuButton className="inline-flex w-full justify-between items-center rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white data-hover:bg-gray-100 dark:data-hover:bg-gray-600 data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-blue-500 data-focus:bg-white dark:data-focus:bg-gray-600">
                          <span className="text-gray-500 dark:text-gray-400">Select scheduler...</span>
                          <ChevronDownIcon className="-mr-1 h-5 w-5 text-gray-400" />
                        </MenuButton>

                        <MenuItems
                          transition
                          anchor="bottom start"
                          className="w-64 origin-top-left rounded-lg bg-white/90 dark:bg-gray-700/90 backdrop-blur-sm shadow-lg p-1 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
                        >
                        {schedulers.length > 0 ? (
                              schedulers
                                .filter(scheduler => !step.targets.some(target => target.target_id === scheduler.id))
                                .map((scheduler) => (
                                <MenuItem key={scheduler.id}>
                                  <button
                                    onClick={() => addSchedulerTargetToStep(step.id, scheduler.id, scheduler.display_name || scheduler.name)}
                                    className="group flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-700 dark:text-gray-200 data-focus:bg-blue-100 dark:data-focus:bg-blue-900"
                                  >
                                    <span>👥</span>
                                    <div className="text-left">
                                      <div className="font-medium">{scheduler.display_name || scheduler.name}</div>
                                      {scheduler.display_name && scheduler.name !== scheduler.display_name && (
                                        <div className="text-xs text-gray-500">{scheduler.name}</div>
                                      )}
                                    </div>
                                  </button>
                                </MenuItem>
                              ))
                          ) : (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                              No schedulers available
                            </div>
                          )}
                          {schedulers.length > 0 && schedulers.every(scheduler => step.targets.some(target => target.target_id === scheduler.id)) && (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                              All schedulers already added
                            </div>
                          )}
                        </MenuItems>
                      </Menu>
                    </div>
                  </div>

                  {/* Target List */}
                  <div className="space-y-2">
                    {step.targets.map((target) => (
                      <div key={target.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                          {target.type === 'scheduler' ? '👥' : '📅'}
                        </div>
                        
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {target.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {target.type === 'scheduler' ? 'Scheduler' : 'Schedule'}: <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">{target.responder}</span>
                          </div>
                        </div>
                        
                        <button
                          onClick={() => removeTargetFromStep(step.id, target.id)}
                          className="text-gray-400 hover:text-red-500 p-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Escalate After */}
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                    <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900 rounded-full flex items-center justify-center">
                      ⏰
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">Escalate after</span>
                    
                    <Menu>
                      <MenuButton className="inline-flex items-center gap-2 rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white data-hover:bg-gray-100 dark:data-hover:bg-gray-600 data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-blue-500 data-focus:bg-white dark:data-focus:bg-gray-600">
                        {step.escalateAfterMinutes === 60 ? '1 hour' : `${step.escalateAfterMinutes} minute${step.escalateAfterMinutes > 1 ? 's' : ''}`}
                        <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                      </MenuButton>

                      <MenuItems
                        transition
                        anchor="bottom end"
                        className="w-32 origin-top-right rounded-lg bg-white/90 dark:bg-gray-700/90 backdrop-blur-sm shadow-lg p-1 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
                      >
                        {[
                          { value: 1, label: '1 minute' },
                          { value: 5, label: '5 minutes' },
                          { value: 10, label: '10 minutes' },
                          { value: 15, label: '15 minutes' },
                          { value: 30, label: '30 minutes' },
                          { value: 60, label: '1 hour' }
                        ].map((option) => (
                          <MenuItem key={option.value}>
                            <button
                              onClick={() => updateStepTimeout(step.id, option.value)}
                              className={`group flex w-full items-center rounded-md px-3 py-2 text-sm text-gray-700 dark:text-gray-200 data-focus:bg-blue-100 dark:data-focus:bg-blue-900 ${
                                step.escalateAfterMinutes === option.value 
                                  ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-300' 
                                  : ''
                              }`}
                            >
                              {option.label}
                            </button>
                          </MenuItem>
                        ))}
                      </MenuItems>
                    </Menu>
                    
                    <span className="text-sm text-gray-700 dark:text-gray-300">if not acknowledged</span>
                  </div>
                </div>
              ))}
            </div>

          {/* Repeat All After */}
          <Field>
            <Label className="text-sm font-medium text-gray-900 dark:text-white">
              Repeat All After *
            </Label>
            <Menu>
              <MenuButton className="mt-2 inline-flex w-full justify-between items-center rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm px-4 py-3 text-sm text-gray-900 dark:text-white data-hover:bg-gray-100 dark:data-hover:bg-gray-600 data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-blue-500 data-focus:bg-white dark:data-focus:bg-gray-600">
                {policyData.repeat_max_times === 0 ? "Infinite repeat" : 
                 policyData.repeat_max_times === 1 ? "1 time (no repeat)" : 
                 `${policyData.repeat_max_times} times`}
                <ChevronDownIcon className="h-5 w-5 text-gray-400" />
              </MenuButton>
              <MenuItems
                transition
                anchor="bottom start"
                className="w-48 origin-top-left rounded-lg bg-white/90 dark:bg-gray-700/90 backdrop-blur-sm shadow-lg p-1 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
              >
                {[
                  { value: 1, label: "1 time (no repeat)" },
                  { value: 2, label: "2 times" },
                  { value: 3, label: "3 times" },
                  { value: 5, label: "5 times" },
                  { value: 0, label: "Infinite repeat" }
                ].map((option) => (
                  <MenuItem key={option.value}>
                    <button
                      onClick={() => setPolicyData(prev => ({ ...prev, repeat_max_times: option.value }))}
                      className="group flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 data-focus:bg-blue-100 dark:data-focus:bg-blue-900"
                    >
                      {option.label}
                    </button>
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              How many times to repeat the entire escalation chain
            </p>
          </Field>
          </div>
          )}
        </div>

                {/* Footer */}
                <div className="mt-6 flex justify-end gap-3 pt-6">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex justify-center rounded-md bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleSubmit(e)}
                    disabled={loading || loadingPolicyDetail}
                    className={`inline-flex justify-center rounded-md px-6 py-2 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 ${
                      isEditMode 
                        ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' 
                        : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                    }`}
                  >
                    {loading ? (
                      <div className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {isEditMode ? 'Updating...' : 'Creating...'}
                      </div>
                    ) : (isEditMode ? 'Update Policy' : 'Create Policy')}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
      
      {/* Toast Notifications */}
      <Toast />
    </Transition>
  );
}
