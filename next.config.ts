import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['192.168.121.82', '192.168.121.125', 'localhost'],
  typescript: {
    ignoreBuildErrors: true,
  },
  api: {
    bodyParser: {
      sizeLimit: '100mb',
    },
  },
};

export default nextConfig;
