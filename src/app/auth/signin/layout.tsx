import type { Metadata } from 'next'

import { serverT } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT()
  const description = t('Войдите в TimelyPlan, чтобы открыть дневник, цели, расписание и учебные инструменты.')
  return {
    title: t('Вход'),
    description,
    alternates: {
      canonical: '/auth/signin',
    },
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title: t('Вход | TimelyPlan'),
      description,
      url: '/auth/signin',
    },
  }
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
