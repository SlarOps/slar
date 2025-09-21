'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../contexts/AuthContext';
import EditGroupModal from '../../../../components/groups/EditGroupModal';

export default function EditGroupPage() {
  const router = useRouter();
  const params = useParams();
  const { session } = useAuth();
  const [showModal, setShowModal] = useState(true);

  const handleGroupUpdated = (updatedGroup) => {
    console.log('Group updated:', updatedGroup);
    // Simply go back - much cleaner!
    router.back();
  };

  const handleClose = () => {
    // Natural browser back navigation
    router.back();
  };

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!session?.access_token) {
      router.push('/login');
    }
  }, [session, router]);

  if (!session?.access_token) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Background page content */}
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <button
            onClick={handleClose}
            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Groups
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Edit Group
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Update your group settings and configuration
            </p>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          </div>
        </div>
      </div>

      {/* Edit Modal Overlay */}
      <EditGroupModal
        isOpen={showModal}
        onClose={handleClose}
        onGroupUpdated={handleGroupUpdated}
        groupId={params.id}
      />
    </div>
  );
}
