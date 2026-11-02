import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['firebase-admin', 'unpdf'],
  experimental: {
    serverActions: { bodySizeLimit: '21mb' },
  },
};

export default nextConfig;
