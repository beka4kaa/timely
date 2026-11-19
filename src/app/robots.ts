import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import {
  DEFAULT_APP_HOSTNAME,
  isAppHostname,
  marketingOriginFromEnv,
  normalizeHostname,
} from '@/lib/host-routing'

// The app lives on app.timely-plan.com while the apex (timely-plan.com) is
// the marketing site. Search engines should only index the apex — the app
// subdomain is behind auth and has nothing worth crawling. Hosts come from the
// same env variables the middleware reads.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers()
  const host = normalizeHostname(headersList.get('x-forwarded-host') ?? headersList.get('host'))
  const appHostname = process.env.TIMELY_APP_HOST ?? DEFAULT_APP_HOSTNAME
  const isAppHost = isAppHostname(host, {
    appHostname,
    appOrigin: `https://${appHostname}`,
    marketingHostname: '',
  })

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
    host: marketingOriginFromEnv(),
  }
}
