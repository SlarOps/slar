import "./globals.css";
import MobileNav from "../components/MobileNav";
import { AuthProvider } from "../contexts/AuthContext";
import AuthWrapper from "../components/auth/AuthWrapper";
import { Toaster } from 'react-hot-toast';

export const metadata = {
  title: "SLAR Web",
  description: "SLAR web console",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased" suppressHydrationWarning={true}>
        <AuthProvider>
          <AuthWrapper>
            <MobileNav />
            <div className="max-w-7xl mx-auto px-1 py-20">
              {children}
            </div>
          </AuthWrapper>
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
        </AuthProvider>
      </body>
    </html>
  );
}
