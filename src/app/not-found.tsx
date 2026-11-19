import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
// Модуль стилей — напрямую: это серверный компонент, а не-компонентные
// экспорты из 'use client'-файла приходят сюда клиентскими ссылками.
import authStyles from '@/components/auth/auth.module.css'
import { LocaleProvider } from '@/lib/i18n/react'
import { serverT } from '@/lib/i18n/server'

// Своя 404 в общем оформлении: стандартная страница Next берёт цвета из
// системной темы и спорила с темой, выбранной в Timely.
export default async function NotFound() {
  const { t, locale } = await serverT()
  return (
    <LocaleProvider locale={locale}>
      <AuthShell
        title={t('Такой страницы нет')}
        subtitle={t('Возможно, ссылка устарела или в адресе опечатка.')}
      >
        <div className={authStyles.actions}>
          <Link href="/" className={authStyles.primary}>
            {t('На главную')}
          </Link>
        </div>
      </AuthShell>
    </LocaleProvider>
  )
}
