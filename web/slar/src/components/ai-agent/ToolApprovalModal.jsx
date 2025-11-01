/**
 * Tool Approval Modal
 * Asks user to approve/deny tool execution
 */

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ExclamationTriangleIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

export function ToolApprovalModal({
  isOpen,
  onClose,
  toolName,
  toolArgs,
  onApprove,
  onDeny
}) {
  const handleApprove = () => {
    onApprove();
    onClose();
  };

  const handleDeny = () => {
    onDeny();
    onClose();
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <ExclamationTriangleIcon className="h-8 w-8 text-yellow-500" />
                  </div>

                  <div className="flex-1">
                    <Dialog.Title
                      as="h3"
                      className="text-lg font-medium leading-6 text-gray-900 dark:text-gray-100"
                    >
                      Tool Execution Request
                    </Dialog.Title>

                    <div className="mt-4">
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Claude wants to execute the following tool. Please review and approve or deny.
                      </p>

                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-3">
                        <div>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Tool Name:</span>
                          <p className="text-sm font-mono text-gray-900 dark:text-gray-100 mt-1">
                            {toolName}
                          </p>
                        </div>

                        {toolArgs && Object.keys(toolArgs).length > 0 && (
                          <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Arguments:</span>
                            <pre className="text-xs font-mono text-gray-900 dark:text-gray-100 mt-1 overflow-x-auto">
                              {JSON.stringify(toolArgs, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex gap-3 justify-end">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                        onClick={handleDeny}
                      >
                        <XMarkIcon className="w-4 h-4" />
                        Deny
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        onClick={handleApprove}
                      >
                        <CheckIcon className="w-4 h-4" />
                        Approve & Execute
                      </button>
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
