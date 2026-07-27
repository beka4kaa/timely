import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

// The app now lives on app.timelyplan.me while the apex (timelyplan.me) is
// the marketing site. Search engines should only index the apex — the app
// subdomain is behind auth and has nothing worth crawling.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers()
  const host = headersList.get('host') ?? ''
  const isAppHost = host === 'app.timelyplan.me'

  if (isAppHost) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/auth/signin', '/auth/register'],
        disallow: ['/api/', '/dashboard/'],
      },
    ],
    host: 'https://timelyplan.me',
  }
}
