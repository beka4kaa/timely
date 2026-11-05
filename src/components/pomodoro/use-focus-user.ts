"use client";

import { useSession } from "next-auth/react";

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true";

/**
 * Кто занимается: пока это неизвестно, статистику не грузим и сессии не отправляем.
 *
 * При обходе авторизации в разработке сессии NextAuth нет, а токен для бэкенда есть
 * (`getServerSession` выдаёт его сам). В сборке без обхода это просто почта из сессии.
 */
export function useFocusUser(): string | null {
  const { data } = useSession();
  return data?.user?.email ?? (DEV_BYPASS_AUTH ? "dev" : null);
}
