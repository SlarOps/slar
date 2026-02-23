/**
 * Runtime Configuration API
 * 
 * This endpoint exposes environment variables to the client at runtime.
 * This is the recommended approach for Next.js apps that need dynamic config
 * without rebuilding the Docker image for each environment.
 * 
 * Usage: fetch('/api/config').then(r => r.json())
 */

export const dynamic = 'force-dynamic'; // Disable caching - always return fresh config

export async function GET() {
  // Server-side environment variables (available at runtime)
  const config = {
    // API URLs
    apiUrl: process.env.NEXT_PUBLIC_API_URL || '/api',
    aiApiUrl: process.env.NEXT_PUBLIC_AI_API_URL || '/ai',
    aiWsUrl: process.env.NEXT_PUBLIC_AI_WS_URL || '',
    
    // Supabase (optional - for storage only)
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    
    // Environment
    env: process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV || 'development',
  };

  return Response.json(config, {
    headers: {
      // Cache for 5 minutes on client, revalidate in background
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    },
  });
}
