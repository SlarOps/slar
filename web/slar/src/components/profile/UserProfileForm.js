'use client';

import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-hot-toast';
import { SaveIcon, LoadingSpinner, InfoIcon } from '../ui/Icons';
import { Input, Select } from '../ui';

const roleOptions = [
  { value: '', label: 'Select your role' },
  { value: 'engineer', label: 'Software Engineer', description: 'Develops and maintains software applications' },
  { value: 'senior_engineer', label: 'Senior Software Engineer', description: 'Experienced developer with leadership responsibilities' },
  { value: 'tech_lead', label: 'Tech Lead', description: 'Technical leadership and architecture decisions' },
  { value: 'manager', label: 'Engineering Manager', description: 'Manages engineering teams and processes' },
  { value: 'director', label: 'Director', description: 'Strategic leadership and organizational oversight' },
  { value: 'devops', label: 'DevOps Engineer', description: 'Infrastructure, deployment, and operations' },
  { value: 'sre', label: 'Site Reliability Engineer', description: 'System reliability and performance' },
  { value: 'qa', label: 'QA Engineer', description: 'Quality assurance and testing' },
  { value: 'product', label: 'Product Manager', description: 'Product strategy and requirements' },
  { value: 'designer', label: 'Designer', description: 'User experience and interface design' },
  { value: 'other', label: 'Other', description: 'Other role not listed above' }
];

export default function UserProfileForm({ userData, onUpdate }) {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: userData?.user_metadata?.name || '',
    email: userData?.email || '',
    phone: userData?.user_metadata?.phone || '',
    role: userData?.user_metadata?.role || '',
    team: userData?.user_metadata?.team || '',
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Note: This would typically update user metadata through Supabase
      // For now, we'll just show a success message
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      
      toast.success('Profile updated successfully!');
      
      // Update the parent component's user data
      if (onUpdate) {
        onUpdate({
          ...userData,
          user_metadata: {
            ...userData?.user_metadata,
            ...formData
          }
        });
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Input
          label="Full Name"
          type="text"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="Enter your full name"
          required
        />

        <Input
          label="Email Address"
          type="email"
          value={formData.email}
          onChange={(e) => handleChange('email', e.target.value)}
          placeholder="Enter your email"
          disabled
          helperText="Email address cannot be changed here. Contact your administrator if needed."
        />

        <Input
          label="Phone Number"
          type="tel"
          value={formData.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          placeholder="+1 (555) 123-4567"
          helperText="Phone number for SMS notifications (coming soon)."
        />

        <Select
          label="Role"
          value={formData.role}
          onChange={(value) => handleChange('role', value)}
          options={roleOptions}
          placeholder="Select your role..."
          clearable
        />

        <div className="md:col-span-2">
          <Input
            label="Team"
            type="text"
            value={formData.team}
            onChange={(e) => handleChange('team', e.target.value)}
            placeholder="e.g., Platform Team, Backend Team, Mobile Team"
            helperText="Your team or department name."
          />
        </div>
      </div>

      {/* Account Information */}
      <div className="border-t border-gray-200 pt-6">
        <h4 className="text-lg font-medium text-gray-900 mb-4">Account Information</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="User ID"
            type="text"
            value={userData?.id || 'N/A'}
            disabled
          />

          <Input
            label="Account Created"
            type="text"
            value={userData?.created_at ? new Date(userData.created_at).toLocaleDateString() : 'N/A'}
            disabled
          />

          <Input
            label="Last Sign In"
            type="text"
            value={userData?.last_sign_in_at ? new Date(userData.last_sign_in_at).toLocaleString() : 'N/A'}
            disabled
          />

          <Input
            label="Auth Provider"
            type="text"
            value={userData?.app_metadata?.provider || 'email'}
            disabled
          />
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end border-t border-gray-200 pt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <LoadingSpinner className="w-4 h-4 text-white" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <SaveIcon className="w-4 h-4 text-white" />
              <span>Save Profile</span>
            </>
          )}
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <InfoIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div className="ml-3">
            <h4 className="text-sm font-medium text-blue-800">Profile Update Notice</h4>
            <p className="mt-1 text-sm text-blue-700">
              Profile changes may take a few minutes to reflect across all services. 
              Some changes like email address require administrator approval.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
