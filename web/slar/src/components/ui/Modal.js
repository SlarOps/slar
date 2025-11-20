'use client';

import { Fragment } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/20/solid';

/**
 * Reusable Modal Component using Headless UI
 * 
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {function} props.onClose - Function to call when modal should close
 * @param {string} props.title - Modal title
 * @param {React.ReactNode} props.children - Modal content
 * @param {string} props.size - Modal size ('sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full')
 * @param {boolean} props.showCloseButton - Whether to show the close button (default: true)
 * @param {boolean} props.closeOnOverlayClick - Whether clicking overlay closes modal (default: true)
 * @param {string} props.className - Additional CSS classes for the modal panel
 * @param {React.ReactNode} props.footer - Optional footer content
 * @param {boolean} props.scrollable - Whether the modal content should be scrollable (default: true)
 * @param {string} props.maxHeight - Maximum height for scrollable content (default: 'calc(90vh-180px)')
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'lg',
  showCloseButton = true,
  closeOnOverlayClick = true,
  className = '',
  footer,
  scrollable = true,
  maxHeight = 'calc(90vh-180px)'
}) {
  // Size mapping for modal widths
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    full: 'max-w-full'
  };

  const handleClose = () => {
    if (closeOnOverlayClick) {
      onClose();
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        {/* Backdrop */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </TransitionChild>

        {/* Modal Container */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className={`w-full ${sizeClasses[size]} transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 text-left align-middle transition-all shadow-2xl dark:shadow-gray-900/50 ${className}`}
              >
                {/* Header */}
                {(title || showCloseButton) && (
                  <div className="flex items-center justify-between p-3 pb-4">
                    {title && (
                      <DialogTitle as="h3" className="text-xl font-semibold leading-6 text-gray-900 dark:text-white">
                        {title}
                      </DialogTitle>
                    )}
                    {showCloseButton && (
                      <button
                        type="button"
                        className="rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-2 transition-colors duration-200"
                        onClick={onClose}
                      >
                        <span className="sr-only">Close</span>
                        <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}

                {/* Content */}
                <div className={`px-2 ${scrollable ? 'overflow-y-auto' : ''} ${footer ? 'pb-4' : 'pb-6'}`}
                  style={scrollable ? { maxHeight } : {}}>
                  {children}
                </div>

                {/* Footer */}
                {footer && (
                  <div className="px-2 py-4 border-t border-gray-200 dark:border-gray-600">
                    {footer}
                  </div>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

/**
 * Modal Footer Component - Helper component for consistent footer styling
 */
export function ModalFooter({ children, className = '' }) {
  return (
    <div className={`flex justify-end gap-3 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Modal Button Components - Helper components for consistent button styling
 */
export function ModalButton({
  variant = 'primary',
  onClick,
  disabled = false,
  loading = false,
  children,
  className = '',
  type = 'button',
  ...props
}) {
  const baseClasses = 'inline-flex justify-center items-center rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm focus:ring-blue-500',
    secondary: 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600',
    success: 'bg-green-600 hover:bg-green-700 text-white shadow-sm focus:ring-green-500',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm focus:ring-red-500',
    warning: 'bg-yellow-600 hover:bg-yellow-700 text-white shadow-sm focus:ring-yellow-500'
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {children}
    </button>
  );
}

/**
 * Confirmation Modal - Pre-built modal for confirmations
 */
export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            {cancelText}
          </ModalButton>
          <ModalButton
            variant={variant}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText}
          </ModalButton>
        </ModalFooter>
      }
    >
      <p className="text-gray-600 dark:text-gray-400">
        {message}
      </p>
    </Modal>
  );
}

/**
 * Loading Modal - Pre-built modal for loading states
 */
export function LoadingModal({
  isOpen,
  title = 'Loading...',
  message = 'Please wait while we process your request.'
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { }} // Prevent closing during loading
      title={title}
      size="md"
      showCloseButton={false}
      closeOnOverlayClick={false}
    >
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center space-x-3">
          <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-gray-600 dark:text-gray-400">{message}</span>
        </div>
      </div>
    </Modal>
  );
}
