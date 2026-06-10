import type { Metadata, Viewport } from 'next'
import { Inter, Plus_Jakarta_Sans, Onest } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { NextAuthProvider } from '@/components/providers/nextauth-provider'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
})

const onest = Onest({
  subsets: ['latin'],
  variable: '--font-onest',
})
// Handwriting font (Caveat) is self-hosted via @font-face in globals.css —
// next/font/google can't reach Google Fonts in some environments.

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#000000' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'TimelyPlan',
  description: 'Школьный дневник, планировщик и не только',
  applicationName: 'TimelyPlan',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TimelyPlan',
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
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${plusJakartaSans.variable} ${onest.variable} font-sans`} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <NextAuthProvider>
            <div className="min-h-screen bg-background">
              {children}
              <Toaster position="top-right" richColors closeButton offset={72} />
            </div>
          </NextAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}