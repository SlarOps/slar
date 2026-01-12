'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function IntegrationsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/agent-config/installed');
  }, [router]);

  return (
    <div className="min-h-screen dark:bg-gray-900 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}
