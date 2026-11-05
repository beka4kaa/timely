import type { Metadata, Viewport } from 'next'
import { Golos_Text, Source_Serif_4 } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { NextAuthProvider } from '@/components/providers/nextauth-provider'
import { Toaster } from '@/components/ui/sonner'

// Golos Text говорит за интерфейс, Source Serif 4 там, где читают: заголовки
// страниц, ответы тьютора, цитаты, формулы. Кириллица обязательна: без неё русский
// текст падал в системный шрифт.
const golos = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-golos',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin', 'cyrillic'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-source-serif',
})
// Handwriting font (Caveat) is self-hosted via @font-face in globals.css —
// next/font/google can't reach Google Fonts in some environments.

const siteName = 'TimelyPlan'
const siteUrl = new URL('https://timelyplan.me')
const siteDescription = 'TimelyPlan — школьный дневник, планировщик, AI-доска и учебные инструменты в одном месте.'

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#000000' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
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
    'AI-доска',
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
    ],
    shortcut: '/logo.svg',
    apple: '/icons/icon-192.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className={`${golos.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
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
