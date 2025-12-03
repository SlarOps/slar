'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { apiClient } from '../lib/api';

const OrgContext = createContext({});

const ORG_STORAGE_KEY = 'slar-current-org';
const PROJECT_STORAGE_KEY = 'slar-current-project';

export const useOrg = () => {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
};

export const OrgProvider = ({ children }) => {
  const { session, isAuthenticated } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [currentOrg, setCurrentOrg] = useState(null);
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load projects for current organization
  const loadProjects = useCallback(async (orgId) => {
    if (!session?.access_token || !orgId) {
      setProjects([]);
      setCurrentProject(null);
      return;
    }

    try {
      setProjectsLoading(true);
      apiClient.setToken(session.access_token);
      const data = await apiClient.getOrgProjects(orgId);
      const projectList = Array.isArray(data) ? data : (data?.projects || []);
      setProjects(projectList);

      // Try to restore previously selected project from localStorage
      const savedProjectId = localStorage.getItem(PROJECT_STORAGE_KEY);
      const savedProject = projectList.find(p => p.id === savedProjectId);

      if (savedProject) {
        setCurrentProject(savedProject);
      } else if (projectList.length > 0) {
        // Default to first project
        setCurrentProject(projectList[0]);
        localStorage.setItem(PROJECT_STORAGE_KEY, projectList[0].id);
      } else {
        setCurrentProject(null);
        localStorage.removeItem(PROJECT_STORAGE_KEY);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
      setProjects([]);
      setCurrentProject(null);
    } finally {
      setProjectsLoading(false);
    }
  }, [session?.access_token]);

  // Load organizations when authenticated
  const loadOrganizations = useCallback(async () => {
    if (!session?.access_token) {
      setOrganizations([]);
      setCurrentOrg(null);
      setProjects([]);
      setCurrentProject(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      apiClient.setToken(session.access_token);
      const data = await apiClient.getOrganizations();
      const orgs = Array.isArray(data) ? data : (data?.organizations || []);
      setOrganizations(orgs);

      // Try to restore previously selected org from localStorage
      const savedOrgId = localStorage.getItem(ORG_STORAGE_KEY);
      const savedOrg = orgs.find(org => org.id === savedOrgId);

      if (savedOrg) {
        setCurrentOrg(savedOrg);
        // Load projects for this org
        await loadProjects(savedOrg.id);
      } else if (orgs.length > 0) {
        // Default to first org
        setCurrentOrg(orgs[0]);
        localStorage.setItem(ORG_STORAGE_KEY, orgs[0].id);
        // Load projects for this org
        await loadProjects(orgs[0].id);
      } else {
        setCurrentOrg(null);
        setProjects([]);
        setCurrentProject(null);
        localStorage.removeItem(ORG_STORAGE_KEY);
        localStorage.removeItem(PROJECT_STORAGE_KEY);
      }
    } catch (err) {
      console.error('Failed to load organizations:', err);
      setError(err.message);
      setOrganizations([]);
      setCurrentOrg(null);
      setProjects([]);
      setCurrentProject(null);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, loadProjects]);

  useEffect(() => {
    if (isAuthenticated) {
      loadOrganizations();
    } else {
      setOrganizations([]);
      setCurrentOrg(null);
      setProjects([]);
      setCurrentProject(null);
      setLoading(false);
    }
  }, [isAuthenticated, loadOrganizations]);

  // Switch to a different organization
  const switchOrg = useCallback(async (org) => {
    if (org && org.id) {
      setCurrentOrg(org);
      localStorage.setItem(ORG_STORAGE_KEY, org.id);
      // Clear current project when switching org
      setCurrentProject(null);
      localStorage.removeItem(PROJECT_STORAGE_KEY);
      // Load projects for new org
      await loadProjects(org.id);
      // Dispatch event so other components can react
      window.dispatchEvent(new CustomEvent('orgChanged', { detail: { org } }));
    }
  }, [loadProjects]);

  // Switch to a different project
  const switchProject = useCallback((project) => {
    if (project && project.id) {
      setCurrentProject(project);
      localStorage.setItem(PROJECT_STORAGE_KEY, project.id);
      // Dispatch event so other components can react
      window.dispatchEvent(new CustomEvent('projectChanged', { detail: { project } }));
    }
  }, []);

  // Refresh organizations list
  const refreshOrganizations = useCallback(async () => {
    await loadOrganizations();
  }, [loadOrganizations]);

  // Refresh projects list
  const refreshProjects = useCallback(async () => {
    if (currentOrg?.id) {
      await loadProjects(currentOrg.id);
    }
  }, [currentOrg?.id, loadProjects]);

  // Add a new organization to the list
  const addOrganization = useCallback((org) => {
    setOrganizations(prev => [...prev, org]);
    // If no current org, set this as current
    if (!currentOrg) {
      switchOrg(org);
    }
  }, [currentOrg, switchOrg]);

  // Add a new project to the list
  const addProject = useCallback((project) => {
    setProjects(prev => [...prev, project]);
    // If no current project, set this as current
    if (!currentProject) {
      switchProject(project);
    }
  }, [currentProject, switchProject]);

  const value = {
    // Organizations
    organizations,
    currentOrg,
    loading,
    error,
    switchOrg,
    refreshOrganizations,
    addOrganization,
    hasOrganizations: organizations.length > 0,
    // Projects
    projects,
    currentProject,
    projectsLoading,
    switchProject,
    refreshProjects,
    addProject,
    hasProjects: projects.length > 0,
  };

  return (
    <OrgContext.Provider value={value}>
      {children}
    </OrgContext.Provider>
  );
};
