'use client';

import { useState } from 'react';
import { Tab } from '@headlessui/react';
import {
  CubeIcon,
  ShoppingBagIcon,
  ServerIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';

import InstalledPluginsTab from '../../components/integrations-v2/InstalledPluginsTab';
import MarketplaceTab from '../../components/integrations-v2/MarketplaceTab';
import MCPServersTab from '../../components/integrations-v2/MCPServersTab';
import MemoryTab from '../../components/integrations-v2/MemoryTab';

const tabs = [
  {
    name: 'Installed',
    icon: CubeIcon,
    component: InstalledPluginsTab,
    description: 'Manage your installed plugins and extensions'
  },
  {
    name: 'Marketplace',
    icon: ShoppingBagIcon,
    component: MarketplaceTab,
    description: 'Browse and install plugins from the marketplace'
  },
  {
    name: 'MCP Servers',
    icon: ServerIcon,
    component: MCPServersTab,
    description: 'Configure Model Context Protocol servers'
  },
  {
    name: 'Memory',
    icon: DocumentTextIcon,
    component: MemoryTab,
    description: 'Manage AI agent memory and context (CLAUDE.md)'
  },
];

export default function IntegrationsPage() {
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Integrations
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Manage plugins, extensions, and MCP server configurations
          </p>
        </div>

        {/* Tabs */}
        <Tab.Group selectedIndex={selectedIndex} onChange={setSelectedIndex}>
          <Tab.List className="flex space-x-1 rounded-xl bg-white dark:bg-gray-800 p-1 mb-6 border border-gray-200 dark:border-gray-700">
            {tabs.map((tab) => (
              <Tab
                key={tab.name}
                className={({ selected }) =>
                  `w-full rounded-lg py-3 px-4 text-sm font-medium leading-5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800
                  ${selected
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`
                }
              >
                {({ selected }) => (
                  <div className="flex items-center justify-center gap-2">
                    <tab.icon className={`h-5 w-5 ${selected ? 'text-white' : ''}`} />
                    <span>{tab.name}</span>
                  </div>
                )}
              </Tab>
            ))}
          </Tab.List>

          <Tab.Panels>
            {tabs.map((tab, idx) => (
              <Tab.Panel
                key={tab.name}
                className="rounded-xl focus:outline-none"
              >
                {/* Tab Description */}
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    {tab.description}
                  </p>
                </div>

                {/* Tab Content */}
                <tab.component />
              </Tab.Panel>
            ))}
          </Tab.Panels>
        </Tab.Group>
      </div>
    </div>
  );
}
