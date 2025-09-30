// Custom Next.js server for runtime environment variable injection
// This allows building once and changing NEXT_PUBLIC_* vars at runtime

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT, 10) || 3000;

// Get runtime environment variables
const getRuntimeEnv = () => {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
};

// Create the injection script
const createEnvScript = () => {
  const env = getRuntimeEnv();
  return `<script>window.__SLAR_ENV = ${JSON.stringify(env)};</script>`;
};

// When running in production with standalone build
if (!dev) {
  const { startServer } = require('next/dist/server/lib/start-server');
  
  // Read the standalone server.js to get the config
  const standaloneServerPath = path.join(__dirname, '.next/standalone/server.js');
  
  if (fs.existsSync(standaloneServerPath)) {
    console.log('Starting standalone server with runtime env injection...');
    
    // Start the Next.js server
    startServer({
      dir: __dirname,
      isDev: false,
      hostname,
      port,
      allowRetry: false,
    }).then((app) => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log('> Runtime environment variables:', getRuntimeEnv());
    }).catch((err) => {
      console.error('Error starting server:', err);
      process.exit(1);
    });
  } else {
    console.error('Standalone build not found. Please run "npm run build" first.');
    process.exit(1);
  }
} else {
  // Development mode
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('Error occurred handling', req.url, err);
        res.statusCode = 500;
        res.end('internal server error');
      }
    }).listen(port, hostname, (err) => {
      if (err) throw err;
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log('> Runtime environment variables:', getRuntimeEnv());
    });
  });
}

