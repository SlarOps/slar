/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // PWA Configuration
  headers: async () => [
    {
      source: '/manifest.json',
      headers: [
        {
          key: 'Content-Type',
          value: 'application/manifest+json',
        },
      ],
    },
  ],
};

export default nextConfig;
