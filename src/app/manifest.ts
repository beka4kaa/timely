import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TimelyPlan',
    short_name: 'TimelyPlan',
    description: 'Школьный дневник, планировщик, AI-тьютор и учебные инструменты.',
    // The app (and therefore the installable PWA) lives on app.timely-plan.com,
    // not the apex marketing domain.
    id: 'https://app.timely-plan.com/',
    scope: '/',
    // '/' is rewritten to /dashboard («Сейчас») internally by the host
    // routing, so launching the PWA costs no extra redirect.
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#121218',
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
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
