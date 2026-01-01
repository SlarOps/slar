'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';

// Generate a URL-friendly slug from name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
};

const STEPS = [
  { id: 'welcome', title: 'Welcome', description: 'Get started with SLAR' },
  { id: 'organization', title: 'Organization', description: 'Create your first organization' },
  { id: 'project', title: 'Project', description: 'Create your first project' },
  { id: 'complete', title: 'Complete', description: 'You\'re all set!' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createdOrg, setCreatedOrg] = useState(null);
  const [createdProject, setCreatedProject] = useState(null);

  // Organization form
  const [orgForm, setOrgForm] = useState({
    name: '',
    slug: '',
    description: '',
  });
  const [orgSlugEdited, setOrgSlugEdited] = useState(false);

  // Project form
  const [projectForm, setProjectForm] = useState({
    name: '',
    slug: '',
    description: '',
  });
  const [projectSlugEdited, setProjectSlugEdited] = useState(false);

  // Check if user already has organizations
  useEffect(() => {
    const checkExistingOrgs = async () => {
      if (!session?.access_token) return;

      try {
        apiClient.setToken(session.access_token);
        const data = await apiClient.getOrganizations();
        const orgs = Array.isArray(data) ? data : (data?.organizations || []);

        if (orgs.length > 0) {
          // User already has orgs, redirect to dashboard
          router.push('/dashboard');
        }
      } catch (err) {
        // No orgs or error - stay on onboarding
        console.log('No existing organizations found');
      }
    };

    if (!authLoading && user) {
      checkExistingOrgs();
    }
  }, [session, authLoading, user, router]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const handleOrgNameChange = (name) => {
    setOrgForm(prev => ({
      ...prev,
      name,
      slug: orgSlugEdited ? prev.slug : generateSlug(name),
    }));
  };

  const handleProjectNameChange = (name) => {
    setProjectForm(prev => ({
      ...prev,
      name,
      slug: projectSlugEdited ? prev.slug : generateSlug(name),
    }));
  };

  const handleCreateOrganization = async () => {
    if (!orgForm.name.trim() || !orgForm.slug.trim()) {
      setError('Organization name and slug are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      apiClient.setToken(session.access_token);
      const newOrg = await apiClient.createOrganization({
        name: orgForm.name.trim(),
        slug: orgForm.slug.trim(),
        description: orgForm.description.trim(),
      });
      setCreatedOrg(newOrg);
      setCurrentStep(2); // Move to project step
    } catch (err) {
      console.error('Error creating organization:', err);
      setError(err.message || 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!projectForm.name.trim() || !projectForm.slug.trim()) {
      setError('Project name and slug are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      apiClient.setToken(session.access_token);
      const newProject = await apiClient.createProject(createdOrg.id, {
        name: projectForm.name.trim(),
        slug: projectForm.slug.trim(),
        description: projectForm.description.trim(),
      });
      setCreatedProject(newProject);
      setCurrentStep(3); // Move to complete step
    } catch (err) {
      console.error('Error creating project:', err);
      setError(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const handleSkipProject = () => {
    setCurrentStep(3); // Skip to complete
  };

  const handleFinish = () => {
    router.push('/dashboard');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Progress Bar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${index < currentStep
                      ? 'bg-emerald-500 text-white'
                      : index === currentStep
                        ? 'bg-emerald-500 text-white ring-4 ring-emerald-100 dark:ring-emerald-900'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                >
                  {index < currentStep ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`w-16 sm:w-24 h-1 mx-2 rounded ${index < currentStep
                        ? 'bg-emerald-500'
                        : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {STEPS[currentStep].title}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {STEPS[currentStep].description}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          {/* Step 0: Welcome */}
          {currentStep === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
              <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Welcome to SLAR
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                Let's get you set up with your first organization and project. This will only take a minute.
              </p>
              <button
                onClick={() => setCurrentStep(1)}
                className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                Get Started
              </button>
            </div>
          )}

          {/* Step 1: Create Organization */}
          {currentStep === 1 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Create Your Organization
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Organizations help you manage teams and projects
                </p>
              </div>

              {error && (
                <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Organization Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={orgForm.name}
                    onChange={(e) => handleOrgNameChange(e.target.value)}
                    placeholder="My Organization"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Slug <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={orgForm.slug}
                    onChange={(e) => {
                      setOrgSlugEdited(true);
                      setOrgForm({ ...orgForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
                    }}
                    placeholder="my-organization"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    URL-friendly identifier (auto-generated from name)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={orgForm.description}
                    onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })}
                    placeholder="What is this organization for?"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setCurrentStep(0)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCreateOrganization}
                  disabled={!orgForm.name.trim() || !orgForm.slug.trim() || loading}
                  className="flex-1 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Creating...
                    </>
                  ) : (
                    'Create Organization'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Create Project */}
          {currentStep === 2 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Create Your First Project
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Projects help you organize incidents and alerts
                </p>

                {createdOrg && (
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-full text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Organization "{createdOrg.name}" created
                  </div>
                )}
              </div>

              {error && (
                <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Project Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={projectForm.name}
                    onChange={(e) => handleProjectNameChange(e.target.value)}
                    placeholder="My Project"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Slug <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={projectForm.slug}
                    onChange={(e) => {
                      setProjectSlugEdited(true);
                      setProjectForm({ ...projectForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
                    }}
                    placeholder="my-project"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    URL-friendly identifier (auto-generated from name)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={projectForm.description}
                    onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                    placeholder="What is this project for?"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleSkipProject}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={!projectForm.name.trim() || !projectForm.slug.trim() || loading}
                  className="flex-1 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Creating...
                    </>
                  ) : (
                    'Create Project'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Complete */}
          {currentStep === 3 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
              <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                You're All Set!
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Your workspace is ready. Start managing your incidents and on-call schedules.
              </p>

              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-6 text-left">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">What you created:</h3>
                <div className="space-y-2">
                  {createdOrg && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Organization: <strong className="text-gray-900 dark:text-white">{createdOrg.name}</strong></span>
                    </div>
                  )}
                  {createdProject && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Project: <strong className="text-gray-900 dark:text-white">{createdProject.name}</strong></span>
                    </div>
                  )}
                  {!createdProject && (
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>You can create projects later from the Projects page</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
