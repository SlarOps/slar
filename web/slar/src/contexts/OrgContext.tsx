'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { apiClient } from '../lib/api';

// Types
interface Organization {
  id: string;
  name: string;
  slug?: string;
  [key: string]: any;
}

interface Project {
  id: string;
  name: string;
  org_id?: string;
  [key: string]: any;
}

interface OrgContextValue {
  // Organizations
  organizations: Organization[];
  currentOrg: Organization | null;
  loading: boolean;
  error: string | null;
  switchOrg: (org: Organization) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  addOrganization: (org: Organization) => void;
  hasOrganizations: boolean;
  // Projects
  projects: Project[];
  currentProject: Project | null;
  projectsLoading: boolean;
  switchProject: (project: Project) => void;
  refreshProjects: () => Promise<void>;
  addProject: (project: Project) => void;
  hasProjects: boolean;
}

const defaultContextValue: OrgContextValue = {
  organizations: [],
  currentOrg: null,
  loading: true,
  error: null,
  switchOrg: async () => {},
  refreshOrganizations: async () => {},
  addOrganization: () => {},
  hasOrganizations: false,
  projects: [],
  currentProject: null,
  projectsLoading: false,
  switchProject: () => {},
  refreshProjects: async () => {},
  addProject: () => {},
  hasProjects: false,
};

const OrgContext = createContext<OrgContextValue>(defaultContextValue);

const ORG_STORAGE_KEY = 'slar-current-org';
const PROJECT_STORAGE_KEY = 'slar-current-project';

export const useOrg = (): OrgContextValue => {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
};

interface OrgProviderProps {
  children: ReactNode;
}

export const OrgProvider = ({ children }: OrgProviderProps) => {
  const { session, isAuthenticated } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load projects for current organization
  const loadProjects = useCallback(async (orgId: string) => {
    if (!session?.access_token || !orgId) {
      setProjects([]);
      setCurrentProject(null);
      return;
    }

    try {
      setProjectsLoading(true);
      apiClient.setToken(session.access_token);
      const data = await apiClient.getOrgProjects(orgId) as any;
      const projectList: Project[] = Array.isArray(data) ? data : (data?.projects || []);
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
      const data = await apiClient.getOrganizations() as any;
      const orgs: Organization[] = Array.isArray(data) ? data : (data?.organizations || []);
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
    } catch (err: any) {
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
  const switchOrg = useCallback(async (org: Organization) => {
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
  const switchProject = useCallback((project: Project) => {
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
  const addOrganization = useCallback((org: Organization) => {
    setOrganizations(prev => [...prev, org]);
    // If no current org, set this as current
    if (!currentOrg) {
      switchOrg(org);
    }
  }, [currentOrg, switchOrg]);

  // Add a new project to the list
  const addProject = useCallback((project: Project) => {
    setProjects(prev => [...prev, project]);
    // If no current project, set this as current
    if (!currentProject) {
      switchProject(project);
    }
  }, [currentProject, switchProject]);

  const value: OrgContextValue = {
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
