'use client';

import { Toaster } from 'react-hot-toast';

export default function Toast({
  position = "top-right",
  duration = 4000,
  successDuration = 3000,
  errorDuration = 5000
}) {
  return (
    <Toaster
      position={position}
      toastOptions={{
        duration: duration,
        style: {
          background: '#363636',
          color: '#fff',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          padding: '12px 16px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        },
        success: {
          duration: successDuration,
          style: {
            background: '#10b981',
            color: '#fff',
          },
          iconTheme: {
            primary: '#fff',
            secondary: '#10b981',
          },
        },
        error: {
          duration: errorDuration,
          style: {
            background: '#ef4444',
            color: '#fff',
          },
          iconTheme: {
            primary: '#fff',
            secondary: '#ef4444',
          },
        },
        loading: {
          style: {
            background: '#10b981',
            color: '#fff',
          },
          iconTheme: {
            primary: '#fff',
            secondary: '#10b981',
          },
        },
        // Custom warning style
        custom: {
          style: {
            background: '#f59e0b',
            color: '#fff',
          },
          iconTheme: {
            primary: '#fff',
            secondary: '#f59e0b',
          },
        },
      }}
    />
  );
}

// Export toast functions for easy import
import toastLib from 'react-hot-toast';

// Create custom toast methods
export const toast = {
  ...toastLib,
  warning: (message, options = {}) => {
    return toastLib(message, {
      style: {
        background: '#f59e0b',
        color: '#fff',
        ...options.style,
      },
      ...options,
    });
  },
};
