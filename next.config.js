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
    // Use Railway backend on production, localhost on dev
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 
      (process.env.VERCEL ? 'https://timely-production-4f5a.up.railway.app' : 'http://localhost:8000');
    return [
      // Auth - handled by Next.js
      {
        source: '/api/auth/:path*',
        destination: '/api/auth/:path*',
      },
      // Mind App - handled by Next.js API routes
      // These routes have their own handlers in src/app/api/
      // {
      //   source: '/api/subjects/:path*',
      //   destination: `${apiUrl}/api/mind/subjects/:path*`,
      // },
      // {
      //   source: '/api/topics/:path*',
      //   destination: `${apiUrl}/api/mind/topics/:path*`,
      // },
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
      {
        source: '/api/learning-program/:path*',
        destination: `${apiUrl}/api/ai_engine/learning-program/:path*`,
      },
      // {
      //   source: '/api/subtopics/:path*',
      //   destination: `${apiUrl}/api/mind/subtopics/:path*`,
      // },
      {
        source: '/api/mind-sessions/:path*',
        destination: `${apiUrl}/api/mind/sessions/:path*`,
      },
      {
        source: '/api/ai/:path*',
        destination: `${apiUrl}/api/ai/:path*`,
      },
    ]
  },
}

module.exports = nextConfig