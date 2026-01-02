/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/a/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  serverExternalPackages: ['bcryptjs'],
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    return [
      // Auth - handled by Next.js
      {
        source: '/api/auth/:path*',
        destination: '/api/auth/:path*',
      },
      // Mind App
      {
        source: '/api/subjects/:path*',
        destination: `${apiUrl}/api/mind/subjects/:path*`,
      },
      {
        source: '/api/topics/:path*',
        destination: `${apiUrl}/api/mind/topics/:path*`,
      },
      // Planner App
      {
        source: '/api/dayplans/:path*',
        destination: `${apiUrl}/api/planner/dayplans/:path*`,
      },
      {
        source: '/api/blocks/:path*',
        destination: `${apiUrl}/api/planner/blocks/:path*`,
      },
      // AI Routes
      {
        source: '/api/ai/generate-program',
        destination: `${apiUrl}/api/ai/generate-program/`,
      },
      // Fallback for everything else
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig