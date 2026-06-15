import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
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
