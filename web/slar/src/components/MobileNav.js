'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/ai-agent', label: 'Assistant' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/monitors', label: 'Monitors' },
  { href: '/groups', label: 'Schedules' },
  { href: '/agent-config', label: 'Integrations' },
];

export default function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(true);
  const { user, signOut, isAuthenticated } = useAuth();
  const pathname = usePathname();

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Listen to custom toggle event from AI agent page
  useEffect(() => {
    const handleToggleNav = (e) => {
      setIsVisible(e.detail.visible);
      if (!e.detail.visible) {
        setIsOpen(false);
      }
    };

    window.addEventListener('toggleNavVisibility', handleToggleNav);
    return () => window.removeEventListener('toggleNavVisibility', handleToggleNav);
  }, []);

  // Close menu when pathname changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Don't show nav on auth pages or desktop (use Sidebar instead)
  if (pathname === '/login' || pathname === '/signup' || !isMobile) {
    return null;
  }

  const handleSignOut = async () => {
    await signOut();
    setIsOpen(false);
  };

  return (
    <>
      {/* Main Navbar */}
      <nav
        className={`fixed inset-x-0 top-0 z-40 bg-background/80 backdrop-blur-md border-b border-black/5 dark:border-white/5 transition-transform duration-300 ${!isVisible ? '-translate-y-full' : 'translate-y-0'
          }`}
      >
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 z-50 relative">
            <span className="text-xl font-bold bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 bg-clip-text text-transparent">
              SLAR
            </span>
          </Link>

          {/* Mobile Hamburger Button */}
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={isOpen}
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 -mr-2 text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors z-50 relative"
          >
            <HamburgerIcon isOpen={isOpen} />
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay & Drawer */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-visibility duration-300 ${isOpen ? 'visible' : 'invisible delay-300'
          }`}
      >
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'
            }`}
          onClick={() => setIsOpen(false)}
        />

        {/* Drawer */}
        <div
          className={`absolute right-0 top-0 bottom-0 w-[280px] bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-800 transform transition-transform duration-300 ease-out-expo ${isOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          <div className="flex flex-col h-full pt-20 pb-6 px-6">
            {isAuthenticated ? (
              <>
                <div className="flex-1 space-y-1">
                  {NAV_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`block px-4 py-3 rounded-xl text-base font-medium transition-colors ${pathname === link.href
                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>

                <div className="mt-auto pt-6 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-3 px-2 mb-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                      {user?.email?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {user?.user_metadata?.full_name || 'User'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {user?.email}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3 mt-4">
                <Link
                  href="/login"
                  className="block w-full text-center px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className="block w-full text-center px-4 py-3 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all"
                >
                  Create Account
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function HamburgerIcon({ isOpen }) {
  return (
    <div className="w-6 h-6 flex flex-col justify-center items-center gap-1.5">
      <span
        className={`block w-5 h-0.5 bg-current rounded-full transition-all duration-300 ${isOpen ? 'rotate-45 translate-y-2' : ''
          }`}
      />
      <span
        className={`block w-5 h-0.5 bg-current rounded-full transition-all duration-300 ${isOpen ? 'opacity-0' : ''
          }`}
      />
      <span
        className={`block w-5 h-0.5 bg-current rounded-full transition-all duration-300 ${isOpen ? '-rotate-45 -translate-y-2' : ''
          }`}
      />
    </div>
  );
}

