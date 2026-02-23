'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../ui';
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  PlusIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LinkIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';
import apiClient from '../../lib/api';

export default function SkillsTab() {
  const { session } = useAuth();
  const [repositories, setRepositories] = useState([]);
  const [installedSkills, setInstalledSkills] = useState(new Set());
  const [installedSkillsData, setInstalledSkillsData] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRepos, setExpandedRepos] = useState(new Set());
  const [updatingRepos, setUpdatingRepos] = useState(new Set());

  // Add repository form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState('repository'); // 'repository' | 'direct'
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [addingRepo, setAddingRepo] = useState(false);
  const [addProgress, setAddProgress] = useState(null);

  useEffect(() => {
    if (session?.access_token) {
      loadSkillData();
    }
  }, [session]);

  // Note: Credentials were removed because:
  // - Credentials API is project-scoped (requires project_id)
  // - Skills are user-scoped (no project context)
  // - Public repos work without credentials (main use case)
  // TODO: Add user-level credentials support for private repos if needed

  const loadSkillData = async () => {
    setLoading(true);

    try {
      if (!session?.access_token) {
        console.log('[SkillsTab] No auth token, skipping load');
        return;
      }

      apiClient.setToken(session.access_token);

      // Load repositories and installed skills in parallel
      const [reposResult, installedResult] = await Promise.all([
        apiClient.getSkillRepositories(),
        apiClient.getInstalledSkills()
      ]);

      if (reposResult.success) {
        setRepositories(reposResult.repositories || []);
        console.log('[SkillsTab] Loaded repositories:', reposResult.repositories.length);
      }

      if (installedResult.success) {
        const skills = installedResult.skills || [];
        const skillKeys = new Set();
        const skillMap = {};

        skills.forEach(skill => {
          const key = `${skill.skill_name}@${skill.repository_name}`;
          skillKeys.add(key);
          skillMap[key] = skill;
        });

        setInstalledSkills(skillKeys);
        setInstalledSkillsData(skillMap);
        console.log('[SkillsTab] Loaded installed skills:', skills.length);
      }

    } catch (error) {
      console.error('[SkillsTab] Failed to load skill data:', error);
      toast.error('Failed to load skill data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRepository = async () => {
    if (!session?.user?.id) {
      toast.error('Please sign in to add repositories');
      return;
    }

    if (!newRepoUrl.trim()) {
      toast.error('Please enter a GitHub URL');
      return;
    }

    // Validate GitHub URL using proper URL parsing (not substring check)
    try {
      const parsed = new URL(newRepoUrl.startsWith('http') ? newRepoUrl : `https://${newRepoUrl}`);
      if (parsed.hostname !== 'github.com') {
        toast.error('Invalid GitHub URL');
        return;
      }
    } catch {
      toast.error('Invalid GitHub URL');
      return;
    }

    setAddingRepo(true);

    try {
      apiClient.setToken(session.access_token);

      if (addMode === 'direct') {
        // Direct skill installation from URL
        setAddProgress({ status: 'Installing skill directly...' });

        const result = await apiClient.installSkillFromUrl({
          skill_url: newRepoUrl.trim()
          // Note: Credentials support can be added later if needed
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to install skill');
        }

        console.log('[SkillsTab] Skill installed directly:', result.skill);

        // Reload data to reflect new direct-installed skill
        await loadSkillData();

        toast.success(`Skill "${result.skill.name}" installed successfully!`);
      } else {
        // Repository installation (existing flow)
        setAddProgress({ status: 'Cloning repository...' });

        const result = await apiClient.addSkillRepository({
          repository_url: newRepoUrl.trim(),
          branch: 'main'
          // Note: Credentials support can be added later if needed
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to add repository');
        }

        console.log('[SkillsTab] Repository added:', result.repository);

        // Add to local state
        setRepositories([...repositories, result.repository]);

        toast.success(`Repository added! Found ${result.skills_count} skill(s)`);
      }

      setNewRepoUrl('');
      setShowAddForm(false);

    } catch (error) {
      console.error('[SkillsTab] Failed:', error);
      toast.error(`Failed: ${error.message}`);
    } finally {
      setAddingRepo(false);
      setAddProgress(null);
    }
  };

  const handleInstallSkill = async (skill, repository) => {
    if (!session?.user?.id) {
      toast.error('Please sign in to install skills');
      return;
    }

    const skillKey = `${skill.name}@${repository.name}`;

    if (installedSkills.has(skillKey)) {
      toast.error('Skill already installed');
      return;
    }

    let toastId;
    try {
      toastId = toast.loading(`Installing ${skill.name}...`);

      apiClient.setToken(session.access_token);
      const result = await apiClient.installSkill({
        skill_name: skill.name,
        repository_name: repository.name,
        skill_path: skill.path,
        version: '1.0.0'
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to install skill');
      }

      console.log('[SkillsTab] Skill installed:', result.skill);

      // Update local state
      setInstalledSkills(new Set([...installedSkills, skillKey]));
      setInstalledSkillsData({
        ...installedSkillsData,
        [skillKey]: result.skill
      });

      if (toastId) toast.dismiss(toastId);
      toast.success(`${skill.name} installed successfully!`);

    } catch (error) {
      console.error('[SkillsTab] Install error:', error);
      if (toastId) toast.dismiss(toastId);
      toast.error(`Failed to install: ${error.message}`);
    }
  };

  const handleUninstallSkill = async (skill, repository) => {
    const skillKey = `${skill.name}@${repository.name}`;
    const installedSkill = installedSkillsData[skillKey];

    if (!installedSkill) {
      toast.error('Skill not found in installed list');
      return;
    }

    if (!confirm(`Are you sure you want to uninstall ${skill.name}?`)) return;

    let toastId;
    try {
      toastId = toast.loading(`Uninstalling ${skill.name}...`);

      apiClient.setToken(session.access_token);
      const result = await apiClient.uninstallSkill(installedSkill.id);

      if (!result.success) {
        throw new Error(result.error || 'Failed to uninstall skill');
      }

      // Update local state
      const newSkills = new Set(installedSkills);
      newSkills.delete(skillKey);
      setInstalledSkills(newSkills);

      const newSkillsData = { ...installedSkillsData };
      delete newSkillsData[skillKey];
      setInstalledSkillsData(newSkillsData);

      if (toastId) toast.dismiss(toastId);
      toast.success(`${skill.name} uninstalled successfully`);

    } catch (error) {
      console.error('[SkillsTab] Uninstall error:', error);
      if (toastId) toast.dismiss(toastId);
      toast.error(`Failed to uninstall: ${error.message}`);
    }
  };

  const handleUpdateRepository = async (repository) => {
    setUpdatingRepos(prev => new Set(prev).add(repository.name));

    let toastId;
    try {
      toastId = toast.loading(`Updating ${repository.name}...`);

      apiClient.setToken(session.access_token);
      const result = await apiClient.updateSkillRepository(repository.name);

      if (!result.success) {
        throw new Error(result.error || 'Failed to update repository');
      }

      if (toastId) toast.dismiss(toastId);

      if (result.had_changes) {
        toast.success(`${repository.name} updated! (${result.skills_count} skills)`);
        await loadSkillData(); // Reload to get new skills
      } else {
        toast.success(`${repository.name} is already up to date`);
      }

    } catch (error) {
      console.error('[SkillsTab] Update error:', error);
      if (toastId) toast.dismiss(toastId);
      toast.error(`Failed to update: ${error.message}`);
    } finally {
      setUpdatingRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(repository.name);
        return newSet;
      });
    }
  };

  const handleDeleteRepository = async (repository) => {
    if (!confirm(`Delete ${repository.name}? This will uninstall all skills from this repository.`)) {
      return;
    }

    let toastId;
    try {
      toastId = toast.loading(`Deleting ${repository.name}...`);

      apiClient.setToken(session.access_token);
      const result = await apiClient.deleteSkillRepository(repository.name);

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete repository');
      }

      // Update local state
      setRepositories(repositories.filter(r => r.name !== repository.name));

      // Remove installed skills from this repo
      const newSkills = new Set();
      const newSkillsData = {};

      installedSkills.forEach(key => {
        if (!key.endsWith(`@${repository.name}`)) {
          newSkills.add(key);
          newSkillsData[key] = installedSkillsData[key];
        }
      });

      setInstalledSkills(newSkills);
      setInstalledSkillsData(newSkillsData);

      if (toastId) toast.dismiss(toastId);
      toast.success(result.message);

    } catch (error) {
      console.error('[SkillsTab] Delete error:', error);
      if (toastId) toast.dismiss(toastId);
      toast.error(`Failed to delete: ${error.message}`);
    }
  };

  const toggleRepo = (repoName) => {
    const newExpanded = new Set(expandedRepos);
    if (newExpanded.has(repoName)) {
      newExpanded.delete(repoName);
    } else {
      newExpanded.add(repoName);
    }
    setExpandedRepos(newExpanded);
  };

  // Filter repositories and skills by search term
  const filteredRepositories = repositories.filter(repo => {
    const repoMatch = repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      repo.repository_url.toLowerCase().includes(searchTerm.toLowerCase());

    const skillsMatch = repo.skills?.some(skill =>
      skill.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return repoMatch || skillsMatch;
  });

  // Get direct-installed skills (skills without corresponding repository)
  const repoNames = new Set(repositories.map(r => r.name));
  const directInstalledSkills = Object.values(installedSkillsData).filter(skill => {
    return !repoNames.has(skill.repository_name);
  });

  if (!session) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400">
          Please sign in to manage skills
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="search"
            placeholder="Search skills and repositories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
        >
          <PlusIcon className="h-5 w-5" />
          <span>Add Repository</span>
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <SparklesIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-blue-900 dark:text-blue-100">
            <p className="font-medium">Skill Repositories</p>
            <p className="text-blue-700 dark:text-blue-300 mt-1">
              Add skill-only repositories from GitHub. Skills are discovered automatically - no marketplace.json required!
            </p>
          </div>
        </div>
      </div>

      {/* Add Repository/Skill Form */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            Add Skill
          </h3>

          {/* Mode Selection */}
          <div className="mb-3 flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="addMode"
                value="repository"
                checked={addMode === 'repository'}
                onChange={(e) => setAddMode(e.target.value)}
                disabled={addingRepo}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Full Repository (discover all skills)
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="addMode"
                value="direct"
                checked={addMode === 'direct'}
                onChange={(e) => setAddMode(e.target.value)}
                disabled={addingRepo}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Single Skill (direct URL)
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={newRepoUrl}
              onChange={(e) => setNewRepoUrl(e.target.value)}
              placeholder={
                addMode === 'repository'
                  ? "https://github.com/owner/repo"
                  : "https://github.com/owner/repo/tree/branch/path/to/skill"
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              onKeyPress={(e) => e.key === 'Enter' && !addingRepo && handleAddRepository()}
              disabled={addingRepo}
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddRepository}
                disabled={addingRepo}
                className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {addingRepo ? 'Adding...' : (addMode === 'direct' ? 'Install' : 'Add')}
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                disabled={addingRepo}
                className="flex-1 sm:flex-none px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>

          {addProgress && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                {addProgress.status}
              </p>
            </div>
          )}

          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {addMode === 'repository' ? (
              <p>Full repository will be cloned and scanned for all SKILL.md files.</p>
            ) : (
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Direct skill installation:</p>
                <p>• Only the specified skill folder will be downloaded (sparse checkout)</p>
                <p>• Example: https://github.com/anthropics/skills/tree/main/skills/frontend-design</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Direct Installed Skills (no repository) */}
      {directInstalledSkills.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Direct Installed Skills
              </h3>
              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded">
                {directInstalledSkills.length} skill{directInstalledSkills.length !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Skills installed directly from URL (sparse checkout)
            </p>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {directInstalledSkills.map((skill) => (
              <div key={skill.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                      {skill.skill_name}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Repository: {skill.repository_name}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">
                      {skill.skill_path}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex px-3 py-1.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded items-center gap-1.5">
                      <CheckCircleIcon className="h-4 w-4" />
                      Installed
                    </span>
                    <button
                      onClick={() => {
                        const skillKey = `${skill.skill_name}@${skill.repository_name}`;
                        if (confirm(`Are you sure you want to uninstall ${skill.skill_name}?`)) {
                          handleUninstallSkill({ name: skill.skill_name }, { name: skill.repository_name });
                        }
                      }}
                      className="inline-flex px-3 py-1.5 text-xs font-medium bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded transition-colors items-center gap-1.5"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Uninstall
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repositories List */}
      {filteredRepositories.length > 0 ? (
        <div className="space-y-3">
          {filteredRepositories.map((repo) => {
            const isExpanded = expandedRepos.has(repo.name);
            const isUpdating = updatingRepos.has(repo.name);
            const skills = repo.skills || [];
            const skillsCount = skills.length;

            return (
              <div key={repo.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                {/* Repository Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                          {repo.name}
                        </h3>
                        <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded">
                          {skillsCount} skill{skillsCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <a
                        href={repo.repository_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                      >
                        <LinkIcon className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{repo.repository_url.replace('https://github.com/', '')}</span>
                      </a>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleUpdateRepository(repo)}
                        disabled={isUpdating}
                        className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
                        title="Update repository"
                      >
                        <ArrowPathIcon className={`h-4 w-4 ${isUpdating ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => handleDeleteRepository(repo)}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        title="Delete repository"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Skills List */}
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {skills.length > 0 ? (
                    skills.map((skill) => {
                      const skillKey = `${skill.name}@${repo.name}`;
                      const isInstalled = installedSkills.has(skillKey);

                      return (
                        <div key={skill.path} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                                {skill.name}
                              </h4>
                              {skill.description && (
                                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                  {skill.description}
                                </p>
                              )}
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">
                                {skill.path}
                              </p>
                            </div>
                            <div className="flex-shrink-0">
                              {isInstalled ? (
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex px-3 py-1.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded items-center gap-1.5">
                                    <CheckCircleIcon className="h-4 w-4" />
                                    Installed
                                  </span>
                                  <button
                                    onClick={() => handleUninstallSkill(skill, repo)}
                                    className="inline-flex px-3 py-1.5 text-xs font-medium bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded transition-colors items-center gap-1.5"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                    Uninstall
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleInstallSkill(skill, repo)}
                                  className="inline-flex px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors items-center gap-1.5"
                                >
                                  <ArrowDownTrayIcon className="h-4 w-4" />
                                  Install
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        No skills found in this repository
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : directInstalledSkills.length === 0 ? (
        <div className="text-center py-12 px-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            No skills found
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Add a skill repository or install a skill directly from URL
          </p>
        </div>
      ) : null}
    </div>
  );
}
