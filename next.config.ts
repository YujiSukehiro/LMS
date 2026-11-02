import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['firebase-admin', 'unpdf'],
  experimental: {
    serverActions: { bodySizeLimit: '21mb' },
  },
};

export default nextConfig;
