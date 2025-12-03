'use client';

import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import MembersModal from '../ui/MembersModal';

export default function ProjectMembersModal({ isOpen, onClose, project, onMemberUpdated }) {
  const { session } = useAuth();

  const fetchMembers = async () => {
    apiClient.setToken(session.access_token);
    return apiClient.getProjectMembers(project.id);
  };

  const searchUsers = async (query, excludeUserIds) => {
    apiClient.setToken(session.access_token);
    const data = await apiClient.searchUsers({ query, excludeUserIds, limit: 5 });
    return data.users || data || [];
  };

  const addMember = async (userId, role) => {
    apiClient.setToken(session.access_token);
    return apiClient.addProjectMember(project.id, { user_id: userId, role });
  };

  const removeMember = async (userId) => {
    apiClient.setToken(session.access_token);
    return apiClient.removeProjectMember(project.id, userId);
  };

  if (!project) return null;

  return (
    <MembersModal
      isOpen={isOpen}
      onClose={onClose}
      title="Project Members"
      subtitle={project?.name}
      infoBanner="Organization members with admin role automatically have access to all projects. Add members here for project-specific access."
      fetchMembers={fetchMembers}
      searchUsers={searchUsers}
      addMember={addMember}
      removeMember={removeMember}
      availableRoles={[
        { value: 'member', label: 'Member' },
        { value: 'admin', label: 'Admin' },
      ]}
      defaultRole="member"
      onMemberUpdated={onMemberUpdated}
    />
  );
}
