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
import { useMe } from "@/lib/contest-api"
import { paperButton, paperCard, paperCaption } from "@/components/curriculum/paper"

export function FullAccessGate({ children }: { children: ReactNode }) {
  const { me, loading } = useMe()

  // Пока грузится — показываем раздел. Заглушка на полсекунды с последующим
  // прыжком на другую страницу хуже, чем содержимое, которое просто есть.
  if (loading) return <>{children}</>

  // `me === null` — это «не знаю»: сеть, 5xx у edge, отсутствие строки в
  // Django. Не повод запирать.
  if (!me) return <>{children}</>

  const denied = me.has_full_access === false && me.is_admin === false
  if (!denied) return <>{children}</>

  // Явный отказ — единственный случай, когда раздел закрыт. И он объясняется,
  // а не заканчивается молчаливым переносом на другую страницу.
  return (
    <div className="mx-auto max-w-[440px] px-5 py-16">
      <div className={`${paperCard} p-6 text-center`}>
        <div className={paperCaption}>Раздел закрыт</div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#5f584f]">
          Доступ к этому разделу выключен для вашего аккаунта. Его включает
          администратор.
        </p>
        <Link href="/dashboard/diary" className={`${paperButton} mt-5`}>
          Вернуться в дневник
        </Link>
      </div>
    </div>
  )
}
