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
  // Next.js's dev-mode rewrite proxy kills upstream requests after 30s by
  // default — that's hardcoded in its own source with the comment "we limit
  // proxy requests to 30s by default, in development"
  // (next/dist/server/lib/router-utils/proxy-request.js). The AI whiteboard
  // pipeline behind `/api/ai/draw` (Llama board generation, then the
  // Banana → SAM2 → Qwen → SVG illustration pipeline) legitimately takes
  // 30-90s end-to-end — well past that default — so the proxy was aborting
  // the connection and handing the browser a bare 500 "Internal Server
  // Error" (visible as `Failed to proxy http://localhost:8000/api/ai/draw
  // [Error: socket hang up] { code: 'ECONNRESET' }` in the dev server log)
  // *before* Django could even respond. Raise the ceiling generously so a
  // slow-but-successful AI response is never mistaken for a server failure.
  experimental: {
    proxyTimeout: parseInt(process.env.NEXT_PROXY_TIMEOUT_MS || '180000', 10),
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  async rewrites() {
    const raw = process.env.NEXT_PUBLIC_API_URL || '';
    // Ensure the URL always has a valid protocol prefix for Next.js rewrites.
    // Falls back to Northflank in Vercel builds, localhost in dev.
    const apiUrl = raw.startsWith('http')
      ? raw
      : (process.env.VERCEL
          ? 'https://p01--timely--qvfcgglmy6nx.code.run'
          : 'http://localhost:8000');
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