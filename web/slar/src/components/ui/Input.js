'use client';

import { forwardRef } from 'react';

/**
 * Reusable Input Component with consistent styling
 * 
 * @param {Object} props - Component props
 * @param {string} props.label - Input label
 * @param {string} props.placeholder - Input placeholder
 * @param {string} props.type - Input type (text, email, password, etc.)
 * @param {string} props.value - Input value
 * @param {function} props.onChange - Change handler
 * @param {function} props.onBlur - Blur handler
 * @param {boolean} props.required - Whether input is required
 * @param {boolean} props.disabled - Whether input is disabled
 * @param {string} props.error - Error message to display
 * @param {string} props.helperText - Helper text to display
 * @param {string} props.className - Additional CSS classes
 * @param {React.ReactNode} props.leftIcon - Icon to display on the left
 * @param {React.ReactNode} props.rightElement - Element to display on the right (e.g., button)
 */
const Input = forwardRef(function Input({
  label,
  placeholder,
  type = 'text',
  value,
  onChange,
  onBlur,
  required = false,
  disabled = false,
  error,
  helperText,
  className = '',
  leftIcon,
  rightElement,
  ...props
}, ref) {
  const baseClasses = 'w-full rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm py-3 px-4 text-sm text-gray-900 dark:text-white focus:outline-2 focus:-outline-offset-2 focus:outline-emerald-500 focus:bg-white dark:focus:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  const errorClasses = error ? 'focus:outline-red-500 bg-red-50/80 dark:bg-red-900/20' : '';

  const inputClasses = `${baseClasses} ${errorClasses} ${leftIcon ? 'pl-10' : ''} ${rightElement ? 'pr-2' : ''} ${className}`;

  return (
    <div className="space-y-1">
      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Input Container */}
      <div className="relative">
        {/* Left Icon */}
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <div className="h-5 w-5 text-gray-400">
              {leftIcon}
            </div>
          </div>
        )}

        {/* Input */}
        <input
          ref={ref}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className={inputClasses}
          {...props}
        />

        {/* Right Element */}
        {rightElement && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
            {rightElement}
          </div>
        )}
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
});

export default Input;
