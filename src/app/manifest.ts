import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TimelyPlan',
    short_name: 'TimelyPlan',
    description: 'Школьный дневник, планировщик, AI-доска и учебные инструменты.',
    // The app (and therefore the installable PWA) lives on app.timelyplan.me,
    // not the apex marketing domain.
    id: 'https://app.timelyplan.me/',
    scope: '/',
    // '/' is rewritten to /dashboard/diary internally by the host routing,
    // so launching the PWA costs no extra redirect.
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#3b82f6',
    orientation: 'portrait',
    lang: 'ru',
    icons: [
      {
        src: '/icons/icon-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
