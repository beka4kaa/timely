import type { Metadata, Viewport } from 'next'
import { Golos_Text, Manrope } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { NextAuthProvider } from '@/components/providers/nextauth-provider'
import { Toaster } from '@/components/ui/sonner'
import { accentBootScript } from '@/lib/accent'
import { langBootScript } from '@/lib/i18n'
import { marketingOriginFromEnv } from '@/lib/host-routing'

// Golos Text говорит за интерфейс, Manrope — за заголовки страниц, ответы тьютора и
// цитаты: геометрический и широкий, он заметно отличается от Golos, и пара не выглядит
// случайной. Формулы остаются курсивом с засечками (--t-math). Кириллица обязательна:
// без неё русский текст падал в системный шрифт.
const golos = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-golos',
})

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-display',
})
// Handwriting font (Caveat) is self-hosted via @font-face in globals.css —
// next/font/google can't reach Google Fonts in some environments.

const siteName = 'TimelyPlan'
const siteUrl = new URL(marketingOriginFromEnv())
const siteDescription = 'TimelyPlan — школьный дневник, планировщик, AI-тьютор и учебные инструменты в одном месте.'

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#000000' },
    { media: '(prefers-color-scheme: dark)', color: '#131315' },
  ],
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: siteName,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  applicationName: siteName,
  authors: [{ name: 'TimelyPlan' }],
  creator: 'TimelyPlan',
  publisher: 'TimelyPlan',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  category: 'education',
  keywords: [
    'TimelyPlan',
    'школьный дневник',
    'планировщик',
    'цели',
    'учебный план',
    'AI-тьютор',
  ],
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName,
    title: siteName,
    description: siteDescription,
    locale: 'ru_RU',
  },
  twitter: {
    card: 'summary',
    title: siteName,
    description: siteDescription,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: siteName,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/logo.svg',
    // iOS ignores SVG touch icons and rounds the corners itself.
    apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className={`${golos.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        {/* Цвет акцента до первой отрисовки, иначе страница мигнёт синим */}
        <script dangerouslySetInnerHTML={{ __html: accentBootScript() }} />
        {/* Язык страницы для чтения с экрана и переносов: английский лендинг или выбор в куке */}
        <script dangerouslySetInnerHTML={{ __html: langBootScript() }} />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextAuthProvider>
            <div className="min-h-screen bg-background">
              {children}
              <Toaster position="bottom-center" closeButton offset={88} />
            </div>
          </NextAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
