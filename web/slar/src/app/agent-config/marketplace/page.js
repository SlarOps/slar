'use client';

import { useState } from 'react';
import MarketplaceTab from '../../../components/integrations/MarketplaceTab';
import SkillsTab from '../../../components/integrations/SkillsTab';

export default function MarketplacePage() {
  const [activeTab, setActiveTab] = useState('plugins');

  return (
    <div className="min-h-screen dark:bg-gray-900">
      <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6">
        <div className="mb-4 sm:mb-6 md:mb-8">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
            Marketplace
          </h1>
          <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            Browse and install plugins and skills for your AI agent
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-4 border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('plugins')}
              className={`
                py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                ${activeTab === 'plugins'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }
              `}
            >
              Plugins
            </button>
            <button
              onClick={() => setActiveTab('skills')}
              className={`
                py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                ${activeTab === 'skills'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }
              `}
            >
              Skills
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'plugins' && <MarketplaceTab />}
        {activeTab === 'skills' && <SkillsTab />}
      </div>
    </div>
  );
}
