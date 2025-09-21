'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AlertsPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to incidents page
    router.replace('/incidents');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-96">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">
          Redirecting to Incidents...
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          We've moved from alerts to incidents for better incident management.
        </p>
      </div>
    </div>
  );
}


