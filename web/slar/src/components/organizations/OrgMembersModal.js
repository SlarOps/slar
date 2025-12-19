'use client';

import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import MembersModal from '../ui/MembersModal';

export default function OrgMembersModal({ isOpen, onClose, organization, onMemberUpdated }) {
  const { session } = useAuth();

  const fetchMembers = async () => {
    apiClient.setToken(session.access_token);
    return apiClient.getOrgMembers(organization.id);
  };

  const searchUsers = async (query, excludeUserIds) => {
    apiClient.setToken(session.access_token);
    const data = await apiClient.searchUsers({ query, excludeUserIds, limit: 5 });
    return data.users || data || [];
  };

  const addMember = async (userId, role) => {
    apiClient.setToken(session.access_token);
    return apiClient.addOrgMember(organization.id, { user_id: userId, role });
  };

  const removeMember = async (userId) => {
    apiClient.setToken(session.access_token);
    return apiClient.removeOrgMember(organization.id, userId);
  };

  const updateMemberRole = async (userId, role) => {
    apiClient.setToken(session.access_token);
    return apiClient.updateOrgMemberRole(organization.id, userId, { role });
  };

  if (!organization) return null;

  return (
    <MembersModal
      isOpen={isOpen}
      onClose={onClose}
      title="Organization Members"
      subtitle={organization?.name}
      fetchMembers={fetchMembers}
      searchUsers={searchUsers}
      addMember={addMember}
      removeMember={removeMember}
      updateMemberRole={updateMemberRole}
      availableRoles={[
        { value: 'member', label: 'Member' },
        { value: 'admin', label: 'Admin' },
      ]}
      defaultRole="member"
      onMemberUpdated={onMemberUpdated}
    />
  );
}
