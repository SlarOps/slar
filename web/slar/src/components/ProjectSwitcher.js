'use client';

import { useState, useRef, useEffect } from 'react';
import { useOrg } from '../contexts/OrgContext';
import Link from 'next/link';

export default function ProjectSwitcher({ collapsed = false }) {
  const { projects, currentProject, switchProject, projectsLoading, currentOrg } = useOrg();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Don't render if no org selected
  if (!currentOrg) {
    return null;
  }

  if (projectsLoading) {
    return (
      <div className={`px-2 py-1 ${collapsed ? 'flex justify-center' : ''}`}>
        <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg h-9 w-full" />
      </div>
    );
  }

  if (!currentProject && projects.length === 0) {
    return (
      <div className={`px-2 py-1 ${collapsed ? 'flex justify-center' : ''}`}>
        <Link
          href="/projects"
          className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          {!collapsed && <span>Create Project</span>}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </Link>
      </div>
    );
  }

  if (!currentProject) {
    return null;
  }

  // Project icon component (cube/folder style)
  const ProjectIcon = ({ className = "w-4 h-4" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );

  return (
    <div className="relative px-2 py-1" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
          collapsed ? 'justify-center' : ''
        }`}
        title={collapsed ? currentProject.name : undefined}
      >
        {/* Project Icon */}
        <ProjectIcon className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />

        {!collapsed && (
          <>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {currentProject.name}
              </div>
            </div>

            {/* Chevron */}
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className={`absolute z-50 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${
          collapsed ? 'left-full ml-2 top-0 w-56' : 'left-2 right-2'
        }`}>
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Switch Project
            </div>
          </div>

          {/* Project List */}
          <div className="max-h-48 overflow-y-auto py-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  switchProject(project);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  project.id === currentProject.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <ProjectIcon className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {project.name}
                  </div>
                  {project.slug && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {project.slug}
                    </div>
                  )}
                </div>
                {project.id === currentProject.id && (
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Footer Actions */}
          <div className="border-t border-gray-100 dark:border-gray-700 p-1.5">
            <Link
              href="/projects"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Manage Projects
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
