import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Регистрация',
  description: 'Создайте аккаунт TimelyPlan для дневника, целей, расписания и учебных инструментов.',
  alternates: {
    canonical: '/auth/register',
  },
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'Регистрация | TimelyPlan',
    description: 'Создайте аккаунт TimelyPlan для дневника, целей, расписания и учебных инструментов.',
    url: '/auth/register',
  },
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children
}
