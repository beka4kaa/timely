import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { NextAuthProvider } from '@/components/providers/nextauth-provider'
import { GeminiChat } from '@/components/gemini-chat'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Time Schedule Platform',
  description: 'A modern platform for managing schedules and time tracking',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <NextAuthProvider>
            <div className="min-h-screen bg-background">
              {children}
              <GeminiChat />
              <Toaster position="top-right" richColors closeButton />
            </div>
          </NextAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}