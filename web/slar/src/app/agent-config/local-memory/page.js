'use client';

import LocalMemoryTab from '../../../components/integrations/LocalMemoryTab';

export default function LocalMemoryPage() {
  return (
    <div className="min-h-screen dark:bg-gray-900">
      <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6">
        <div className="mb-4 sm:mb-6 md:mb-8">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
            Project Memory
          </h1>
          <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            Manage project-scoped AI agent memory. All team members in this project share this memory.
          </p>
        </div>
        <LocalMemoryTab />
      </div>
    </div>
  );
}
