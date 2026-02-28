import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { NextAuthProvider } from '@/components/providers/nextauth-provider'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({ subsets: ['latin'] })

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3b82f6' },
    { media: '(prefers-color-scheme: dark)', color: '#08101e' },
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
      <body className={inter.className} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <NextAuthProvider>
            <div className="min-h-screen bg-background">
              {children}
              <Toaster position="top-right" richColors closeButton />
            </div>
          </NextAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}