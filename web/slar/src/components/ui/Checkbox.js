'use client';

import { forwardRef } from 'react';

/**
 * Reusable Checkbox Component with consistent styling
 * 
 * @param {Object} props - Component props
 * @param {string} props.label - Checkbox label
 * @param {boolean} props.checked - Whether checkbox is checked
 * @param {function} props.onChange - Change handler
 * @param {boolean} props.disabled - Whether checkbox is disabled
 * @param {string} props.description - Description text below label
 * @param {string} props.error - Error message to display
 * @param {string} props.className - Additional CSS classes for container
 * @param {string} props.size - Checkbox size ('sm', 'md', 'lg')
 */
const Checkbox = forwardRef(function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  description,
  error,
  className = '',
  size = 'md',
  ...props
}, ref) {
  const sizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5'
  };

  const checkboxClasses = `${sizeClasses[size]} text-blue-600 focus:ring-blue-500 border-gray-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed`;

  return (
    <div className={`space-y-1 ${className}`}>
      <label className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className={checkboxClasses}
          {...props}
        />
        <div className="flex-1">
          {label && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {label}
            </span>
          )}
          {description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {description}
            </p>
          )}
        </div>
      </label>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 ml-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
});

/**
 * Checkbox Group Component for multiple related checkboxes
 */
export function CheckboxGroup({ 
  label, 
  children, 
  error, 
  className = '',
  containerClassName = ''
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      
      <div className={`p-4 bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm rounded-lg space-y-3 ${containerClassName}`}>
        {children}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

export default Checkbox;
