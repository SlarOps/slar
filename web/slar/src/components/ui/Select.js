'use client';

import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';

/**
 * Reusable Select Component using Headless UI Menu
 * 
 * @param {Object} props - Component props
 * @param {string} props.label - Select label
 * @param {string|number} props.value - Selected value
 * @param {function} props.onChange - Change handler (receives selected value)
 * @param {Array} props.options - Array of options {value, label, description?, disabled?}
 * @param {string} props.placeholder - Placeholder text when no option selected
 * @param {boolean} props.required - Whether select is required
 * @param {boolean} props.disabled - Whether select is disabled
 * @param {string} props.error - Error message to display
 * @param {string} props.helperText - Helper text to display
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.clearable - Whether to show clear option
 * @param {string} props.clearText - Text for clear option
 * @param {React.ReactNode} props.leftIcon - Icon to display on the left
 */
export default function Select({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'Select an option...',
  required = false,
  disabled = false,
  error,
  helperText,
  className = '',
  clearable = false,
  clearText = 'Clear selection',
  leftIcon,
  ...props
}) {
  const selectedOption = options.find(option => option.value === value);
  
  const buttonClasses = `inline-flex w-full justify-between items-center rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm px-4 py-3 text-sm text-gray-900 dark:text-white data-hover:bg-gray-100 dark:data-hover:bg-gray-600 data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-blue-500 data-focus:bg-white dark:data-focus:bg-gray-600 transition-colors ${
    disabled ? 'opacity-50 cursor-not-allowed' : ''
  } ${error ? 'data-focus:outline-red-500 bg-red-50/80 dark:bg-red-900/20' : ''} ${leftIcon ? 'pl-10' : ''} ${className}`;

  return (
    <div className="space-y-1">
      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Select Container */}
      <div className="relative">
        {/* Left Icon */}
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
            <div className="h-5 w-5 text-gray-400">
              {leftIcon}
            </div>
          </div>
        )}

        <Menu>
          <MenuButton 
            disabled={disabled}
            className={buttonClasses}
            {...props}
          >
            <span className={selectedOption ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <ChevronDownIcon className="h-5 w-5 text-gray-400" />
          </MenuButton>
          
          <MenuItems
            transition
            anchor="bottom start"
            className="w-64 origin-top-left rounded-lg bg-white/90 dark:bg-gray-700/90 backdrop-blur-sm shadow-lg p-1 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0 z-50"
          >
            {/* Clear selection option */}
            {clearable && value && (
              <>
                <MenuItem>
                  <button
                    onClick={() => onChange(null)}
                    className="group flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400 data-focus:bg-gray-100 dark:data-focus:bg-gray-600 italic"
                  >
                    {clearText}
                  </button>
                </MenuItem>
                <div className="border-t border-gray-200 dark:border-gray-600 my-1" />
              </>
            )}
            
            {/* Options */}
            {options.length > 0 ? (
              options.map((option) => (
                <MenuItem key={option.value} disabled={option.disabled}>
                  <button
                    onClick={() => onChange(option.value)}
                    disabled={option.disabled}
                    className={`group flex w-full items-start rounded-lg px-3 py-2 text-sm data-focus:bg-blue-100 dark:data-focus:bg-blue-900 disabled:opacity-50 disabled:cursor-not-allowed ${
                      value === option.value 
                        ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-300' 
                        : 'text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <div className="text-left flex-1">
                      <div className="font-medium">{option.label}</div>
                      {option.description && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {option.description}
                        </div>
                      )}
                    </div>
                    {value === option.value && (
                      <svg className="w-4 h-4 text-blue-600 dark:text-blue-300 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </MenuItem>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                No options available
              </div>
            )}
          </MenuItems>
        </Menu>
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

      {/* Helper Text */}
      {helperText && !error && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {helperText}
        </p>
      )}
    </div>
  );
}
