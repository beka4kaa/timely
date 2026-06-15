import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Вход',
  description: 'Войдите в TimelyPlan, чтобы открыть дневник, цели, расписание и учебные инструменты.',
  alternates: {
    canonical: '/auth/signin',
  },
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'Вход | TimelyPlan',
    description: 'Войдите в TimelyPlan, чтобы открыть дневник, цели, расписание и учебные инструменты.',
    url: '/auth/signin',
  },
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
