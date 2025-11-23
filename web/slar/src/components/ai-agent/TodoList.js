/**
 * TodoList Component - Compact task progress display
 * 
 * Shows todos from Claude Agent SDK with status indicators:
 * ❌ pending | 🔧 in_progress | ✅ completed
 */

import { useState } from 'react';

export function TodoList({ todos }) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!todos || todos.length === 0) {
        return null;
    }

    const completed = todos.filter(t => t.status === 'completed').length;
    const inProgress = todos.filter(t => t.status === 'in_progress').length;
    const total = todos.length;

    const getIcon = (status) => {
        switch (status) {
            case 'completed':
                return (
                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
            case 'in_progress':
                return (
                    <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
            case 'pending':
            default:
                return (
                    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
        }
    };

    return (
        <div className="todo-list-compact bg-white/80 dark:bg-gray-800/80 py-1">
            {/* Compact Progress Header - Always visible, clickable */}
            <div
                className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded px-2 py-1 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    {/* Expand/Collapse Icon */}
                    <svg
                        className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>

                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                        Progress:
                    </span>
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                        {completed}/{total}
                    </span>
                    {inProgress > 0 && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                            ({inProgress} active)
                        </span>
                    )}
                </div>

                {/* Mini Progress Bar */}
                <div className="w-20 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${(completed / total) * 100}%` }}
                    />
                </div>
            </div>

            {/* Expandable Todo Items */}
            {isExpanded && (
                <ul className="space-y-1 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    {todos.map((todo, index) => {
                        const icon = getIcon(todo.status);
                        const text = todo.status === 'in_progress' && todo.activeForm
                            ? todo.activeForm
                            : todo.content;

                        return (
                            <li
                                key={index}
                                className="flex items-start gap-2 text-xs px-2"
                            >
                                <span className="flex-shrink-0 mt-0.5">
                                    {icon}
                                </span>
                                <span className={`flex-1 leading-relaxed ${todo.status === 'completed'
                                    ? 'text-gray-400 dark:text-gray-500 line-through'
                                    : todo.status === 'in_progress'
                                        ? 'text-gray-700 dark:text-gray-300 font-medium'
                                        : 'text-gray-600 dark:text-gray-400'
                                    }`}>
                                    {text}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
