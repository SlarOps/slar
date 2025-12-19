import "./globals.css";

import MobileNav from "../components/MobileNav";
import Sidebar from "../components/Sidebar";
import MainContent from "../components/MainContent";
import PWAInstallPrompt from "../components/PWAInstallPrompt";
import { AuthProvider } from "../contexts/AuthContext";
import { SidebarProvider } from "../contexts/SidebarContext";
import { OrgProvider } from "../contexts/OrgContext";
import AuthWrapper from "../components/auth/AuthWrapper";
import { Toaster } from 'react-hot-toast';

export const metadata = {
  title: "SLAR Console",
  description: "SLAR monitoring & incident management console",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SLAR",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icon-152x152.png', sizes: '152x152', type: 'image/png' },
    ],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#2563eb',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-gray-50 dark:bg-gray-950" suppressHydrationWarning={true}>
        <AuthProvider>
          <SidebarProvider>
            <OrgProvider>
              <AuthWrapper>
                {/* Desktop Sidebar */}
                <Sidebar />
              
              {/* Mobile Top Nav */}
              <MobileNav />
              
              {/* Main Content - margin adjusts based on sidebar state */}
              <MainContent>
                {children}
              </MainContent>
            </AuthWrapper>
            </OrgProvider>
            <PWAInstallPrompt />
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                  borderRadius: '8px',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#10b981',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </SidebarProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
