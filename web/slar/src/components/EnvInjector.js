// Server Component to inject runtime environment variables
// This runs on the server and injects the script into the HTML

export default function EnvInjector() {
  // Get runtime environment variables from process.env
  const runtimeEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };

  // Create the script content
  const scriptContent = `window.__SLAR_ENV = ${JSON.stringify(runtimeEnv)};`;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: scriptContent }}
      // This script must run before any other scripts
      // so we use a blocking script tag
    />
  );
}

