'use client';

import { Switch as HeadlessSwitch } from '@headlessui/react';

/**
 * Reusable Switch/Toggle Component using Headless UI
 *
 * @param {Object} props
 * @param {boolean} props.checked - Whether the switch is on
 * @param {function} props.onChange - Called with new boolean value
 * @param {string} [props.label] - Label text
 * @param {string} [props.description] - Description text below label
 * @param {boolean} [props.disabled] - Whether the switch is disabled
 * @param {string} [props.size] - Size variant: 'sm' | 'md' (default 'md')
 * @param {string} [props.className] - Additional CSS classes for container
 */
export default function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  className = '',
}) {
  // Sizing follows Headless UI reference pattern: track with p-0.5, thumb fills inner height
  // sm: track 20×36, pad 2, inner 16×32, thumb 16, translate 16 = translate-x-4
  // md: track 24×44, pad 2, inner 20×40, thumb 20, translate 20 = translate-x-5
  const sizes = {
    sm: { track: 'h-5 w-9', thumb: 'h-4 w-4', on: 'translate-x-4' },
    md: { track: 'h-6 w-11', thumb: 'h-5 w-5', on: 'translate-x-5' },
  };
  const s = sizes[size] || sizes.md;

  const toggle = (
    <HeadlessSwitch
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className={`relative inline-flex ${s.track} items-center shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out
        ${checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900
        disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block ${s.thumb} ${checked ? s.on : 'translate-x-0'} rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
      />
    </HeadlessSwitch>
  );

  if (!label) return <div className={className}>{toggle}</div>;

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="min-w-0 flex-1 mr-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
        )}
      </div>
      {toggle}
    </div>
  );
}
