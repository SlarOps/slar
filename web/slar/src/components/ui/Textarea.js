'use client';

import { forwardRef } from 'react';

/**
 * Reusable Textarea Component with consistent styling
 * 
 * @param {Object} props - Component props
 * @param {string} props.label - Textarea label
 * @param {string} props.placeholder - Textarea placeholder
 * @param {string} props.value - Textarea value
 * @param {function} props.onChange - Change handler
 * @param {function} props.onBlur - Blur handler
 * @param {number} props.rows - Number of rows
 * @param {boolean} props.required - Whether textarea is required
 * @param {boolean} props.disabled - Whether textarea is disabled
 * @param {boolean} props.resize - Whether textarea is resizable
 * @param {string} props.error - Error message to display
 * @param {string} props.helperText - Helper text to display
 * @param {string} props.className - Additional CSS classes
 */
const Textarea = forwardRef(function Textarea({
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  rows = 3,
  required = false,
  disabled = false,
  resize = false,
  error,
  helperText,
  className = '',
  ...props
}, ref) {
  const baseClasses = 'w-full rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm py-3 px-4 text-sm text-gray-900 dark:text-white focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500 focus:bg-white dark:focus:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  
  const errorClasses = error ? 'focus:outline-red-500 bg-red-50/80 dark:bg-red-900/20' : '';
  const resizeClasses = resize ? 'resize-y' : 'resize-none';
  
  const textareaClasses = `${baseClasses} ${errorClasses} ${resizeClasses} ${className}`;

  return (
    <div className="space-y-1">
      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Textarea */}
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        required={required}
        disabled={disabled}
        className={textareaClasses}
        {...props}
      />

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

export default Textarea;
