import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
// Модуль стилей — напрямую: это серверный компонент, а не-компонентные
// экспорты из 'use client'-файла приходят сюда клиентскими ссылками.
import authStyles from '@/components/auth/auth.module.css'

// Своя 404 в общем оформлении: стандартная страница Next берёт цвета из
// системной темы и спорила с темой, выбранной в Timely.
export default function NotFound() {
  return (
    <AuthShell
      title="Такой страницы нет"
      subtitle="Возможно, ссылка устарела или в адресе опечатка."
    >
      <div className={authStyles.actions}>
        <Link href="/" className={authStyles.primary}>
          На главную
        </Link>
      </div>
    </AuthShell>
  )
}
