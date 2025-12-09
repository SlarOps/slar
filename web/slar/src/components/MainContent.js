'use client';

import { useSidebar } from '../contexts/SidebarContext';
import { usePathname } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

// Pages that should be full-bleed (no container padding)
const FULL_BLEED_PAGES = ['/ai-agent'];

export default function MainContent({ children }) {
  const { collapsed, isMobile } = useSidebar();
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();

  // No sidebar margin for auth pages, onboarding, or unauthenticated users
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isOnboardingPage = pathname === '/onboarding';
  const isFullBleed = FULL_BLEED_PAGES.includes(pathname) || isOnboardingPage;
  const showSidebarMargin = !isMobile && isAuthenticated && !isAuthPage && !isOnboardingPage;

  return (
    <main
      className={`transition-all duration-300 ${showSidebarMargin
        ? collapsed
          ? 'md:ml-16'
          : 'md:ml-60'
        : ''
        } ${isMobile ? 'pt-14' : 'pt-0'} ${isFullBleed ? 'h-screen' : 'min-h-screen'}`}
    >
      {isFullBleed ? (
        // Full-bleed layout for chat/AI pages - scrollbar at edge
        <div className={`h-full ${isMobile ? 'h-[calc(100vh-56px)]' : 'h-screen'}`}>
          {children}
        </div>
      ) : (
        // Standard container layout
        <div className={`mx-auto py-6 ${isAuthPage ? '' : 'max-w-7xl'}`}>
          {children}
        </div>
      )}
    </main>
  );
}
