import { NextResponse } from 'next/server';

export function middleware(request) {
  // Get runtime environment variables from process.env
  const runtimeEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };

  // Create response
  const response = NextResponse.next();

  // Add custom header with runtime env (will be used by layout to inject script)
  response.headers.set('x-slar-env', JSON.stringify(runtimeEnv));

  return response;
}

// Only run middleware on HTML pages (not API routes, static files, etc.)
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

