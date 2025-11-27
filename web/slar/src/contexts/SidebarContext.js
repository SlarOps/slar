'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const SidebarContext = createContext(undefined);

export function SidebarProvider({ children }) {
  // Default to collapsed to prevent layout shift
  const [collapsed, setCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(true);

  // Check mobile and load saved state (client-side only)
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      
      if (mobile) {
        setCollapsed(true);
      } else {
        // Load saved state for desktop
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved !== null) {
          setCollapsed(JSON.parse(saved));
        } else {
          setCollapsed(false); // Default expanded on desktop
        }
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Save state when changed (desktop only)
  const handleSetCollapsed = (value) => {
    setCollapsed(value);
    if (!isMobile) {
      localStorage.setItem('sidebar-collapsed', JSON.stringify(value));
    }
  };

  return (
    <SidebarContext.Provider value={{ 
      collapsed, 
      setCollapsed: handleSetCollapsed, 
      isMobile 
    }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
