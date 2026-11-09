"use client"

// Закрытие раздела для конкретного человека.
//
// РАНЬШЕ БЫЛО НАОБОРОТ, и это выбрасывало почти всех. Гейт пускал только при
// `has_full_access || is_admin`, а всё остальное — «ещё грузится», «запрос
// упал», «бэкенд отдал 503», «пользователя нет в базе Django» — сваливалось в
// одно состояние «не пущу» и молча уводило на дневник.
//
// Для реальных пользователей это был приговор: регистрация пишет их в
// `lib/local-users.ts` (JSON-файл), в Django `RegisterView` не ходит никто, и
// `/api/me/` навсегда отвечает `{authenticated: false}`. Строки, у которой мог
// бы стоять флаг, попросту нет. Владельца пропускало только потому, что его
// аккаунт заведён в Django руками и он админ.
//
// Теперь правило перевёрнуто: раздел открыт, пока сервер ОПРЕДЕЛЁННО не сказал
// обратное. Упавший запрос профиля не должен запирать продукт — цена ошибки
// несимметрична: лишний раз пустить не страшно, а запереть всех страшно.

import type { ReactNode } from "react"
import Link from "next/link"
import { getMe, useMe } from "@/lib/contest-api"
import { useResource } from "@/lib/resource-cache"
import { paperButton, paperCard, paperCaption } from "@/components/curriculum/paper"

/**
 * Раздел для этого человека закрыт — сервер ОПРЕДЕЛЁННО так сказал.
 *
 * То же правило, что у самого гейта, для мест, которые показывают данные
 * закрытых разделов вне их страниц: главная «Сейчас» и отметки рейла.
 */
export function useFullAccessDenied(): boolean {
  // Через общий кэш: рейл и главная спрашивают одно и то же, и два
  // одинаковых запроса профиля на каждую страницу ни к чему.
  const { data: me, loading } = useResource("me", getMe, { ttl: 5 * 60_000 })
  if (loading || !me || me.authenticated === false) return false
  return me.has_full_access === false && me.is_admin === false
}

/**
 * `denied`: что показать вместо раздела, если он закрыт. Без него закрытый раздел
 * объясняется карточкой.
 */
export function FullAccessGate({ children, denied: fallback }: { children: ReactNode; denied?: ReactNode }) {
  const { me, loading } = useMe()

  // Пока грузится — показываем раздел. Заглушка на полсекунды с последующим
  // прыжком на другую страницу хуже, чем содержимое, которое просто есть.
  if (loading) return <>{children}</>

  // `me === null` — это «не знаю»: сеть, 5xx у edge, отсутствие строки в
  // Django. Не повод запирать.
  if (!me) return <>{children}</>

  const denied = me.has_full_access === false && me.is_admin === false
  if (!denied) return <>{children}</>
  if (fallback) return <>{fallback}</>

  // Явный отказ — единственный случай, когда раздел закрыт. И он объясняется,
  // а не заканчивается молчаливым переносом на другую страницу.
  return (
    <div className="mx-auto max-w-[440px] px-5 py-16">
      <div className={`${paperCard} p-6 text-center`}>
        <div className={paperCaption}>Раздел закрыт</div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-tm-ink-2">
          Доступ к этому разделу выключен для вашего аккаунта. Его включает
          администратор.
        </p>
        <Link href="/dashboard" className={`${paperButton} mt-5`}>
          На главную
        </Link>
      </div>
    </div>
  )
}
