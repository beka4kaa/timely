import type { Metadata } from 'next'

import { serverT } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT()
  const description = t('Создайте аккаунт TimelyPlan для дневника, целей, расписания и учебных инструментов.')
  return {
    title: t('Регистрация'),
    description,
    alternates: {
      canonical: '/auth/register',
    },
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title: t('Регистрация | TimelyPlan'),
      description,
      url: '/auth/register',
    },
  }
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children
}
