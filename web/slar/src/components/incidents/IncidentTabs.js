'use client';

export default function IncidentTabs({ 
  activeTab = 'triggered', 
  onTabChange, 
  stats = {} 
}) {
  const tabs = [
    { 
      id: 'triggered', 
      label: 'Triggered', 
      count: stats.triggered || 0 
    },
    { 
      id: 'acknowledged', 
      label: 'Acknowledged', 
      count: stats.acknowledged || 0 
    },
    { 
      id: 'any_status', 
      label: 'Any Status', 
      count: stats.total || 0 
    }
  ];

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      <nav className="-mb-px flex space-x-4 md:space-x-8 px-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-2 py-0.5 px-2 rounded-full text-xs ${
                activeTab === tab.id
                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                  : 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-300'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
