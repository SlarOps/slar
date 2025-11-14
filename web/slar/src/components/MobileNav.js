'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '../contexts/AuthContext';
import { usePathname } from 'next/navigation';

export default function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const { user, signOut, isAuthenticated } = useAuth();
  const pathname = usePathname();

  // Listen to custom toggle event from AI agent page
  useEffect(() => {
    const handleToggleNav = (e) => {
      setIsVisible(e.detail.visible);
      if (!e.detail.visible) {
        setIsOpen(false); // Close menu when hiding
      }
    };

    window.addEventListener('toggleNavVisibility', handleToggleNav);
    return () => window.removeEventListener('toggleNavVisibility', handleToggleNav);
  }, []);

  // Don't show nav on auth pages
  if (pathname === '/login' || pathname === '/signup') {
    return null;
  }

  const handleSignOut = async () => {
    await signOut();
    setIsOpen(false);
  };

  return (
    <nav className={`fixed inset-x-0 top-0 z-50 bg-background border-b border-black/10 dark:border-white/10 transition-transform duration-300 ${
      !isVisible ? '-translate-y-full' : 'translate-y-0'
    }`}>
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 bg-clip-text text-transparent">SLAR</span>
        </Link>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((v) => !v)}
          className="md:hidden p-2 rounded hover:bg-black/5 dark:hover:bg-white/10"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="size-6"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        <div className="hidden md:flex items-center gap-6">
          {isAuthenticated && <NavLinks />}
          <UserMenu />
        </div>
      </div>

      <div
        className={`${isOpen ? 'block' : 'hidden'} md:hidden border-t border-black/10 dark:border-white/10`}
      >
        <div className="px-4 py-3 grid gap-2">
          {isAuthenticated ? (
            <>
              <NavLinks onNavigate={() => setIsOpen(false)} />
              <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  {user?.email}
                </div>
                <button
                  onClick={handleSignOut}
                  className="text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
                >
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Link 
                href="/login" 
                onClick={() => setIsOpen(false)}
                className="block text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Sign In
              </Link>
              <Link 
                href="/signup" 
                onClick={() => setIsOpen(false)}
                className="block text-sm font-medium text-green-600 dark:text-green-400 hover:underline"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

function NavLinks({ onNavigate }) {
  return (
    <>
      <Link href="/ai-agent" onClick={onNavigate} className="text-sm font-medium hover:underline">
        Assistant
      </Link>
      <Link href="/incidents" onClick={onNavigate} className="text-sm font-medium hover:underline">
        Incidents
      </Link>
      <Link href="/groups" onClick={onNavigate} className="text-sm font-medium hover:underline">
        Groups
      </Link>
      <Link href="/uptime" onClick={onNavigate} className="text-sm font-medium hover:underline">
        Uptime
      </Link>
      <Link href="/integrations" onClick={onNavigate} className="text-sm font-medium hover:underline">
        Agent Config
      </Link>
    </>
  );
}

function UserMenu() {
  const { user, signOut, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    setIsOpen(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-3">
        <Link 
          href="/login"
          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Sign In
        </Link>
        <Link 
          href="/signup"
          className="text-sm font-medium px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Sign Up
        </Link>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-medium hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-medium">
          {user?.email?.charAt(0).toUpperCase() || 'U'}
        </div>
        <span className="hidden lg:block">{user?.email}</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {user?.user_metadata?.full_name || 'User'}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {user?.email}
              </div>
            </div>
            
            <div className="p-2">
              <Link
                href="/profile"
                onClick={() => setIsOpen(false)}
                className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                Profile Settings
              </Link>
              <button
                onClick={handleSignOut}
                className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
              >
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


