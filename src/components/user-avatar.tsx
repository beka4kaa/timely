"use client";

import { useSession } from "next-auth/react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * Единственный источник правды для аватарки ТЕКУЩЕГО пользователя.
 *
 * Раньше её рисовали четырьмя разными способами, и она заметно «прыгала»:
 *
 *  - сайдбар подставлял `session?.user?.image || "/avatars/user.jpg"`, но
 *    файла `public/avatars/user.jpg` в репозитории нет вообще. Пока
 *    `useSession()` в статусе "loading", `image` — undefined, браузер уходил
 *    за несуществующей картинкой, ловил 404, Radix переключался на инициалы,
 *    а через мгновение доезжала сессия и подставляла фото Google. Отсюда
 *    видимая смена аватарки на каждой навигации;
 *  - whiteboard и мобильное меню вместо аватара рисовали иконку `UserRound`
 *    — ни фото, ни инициалов;
 *  - мёртвый `nav-user.tsx` брал картинку из пропа `user.avatar`.
 *
 * Здесь этого нет: пока сессия грузится — нейтральный скелетон (не инициалы и
 * не битая картинка), `AvatarImage` рендерится только при реально имеющемся
 * URL, а фолбэк — детерминированные инициалы.
 */

interface UserAvatarProps {
  /** Сторона квадрата в px. Радиус скругления считается от неё. */
  size?: number;
  className?: string;
}

/** «Бекжан Миронов» → «БМ»; без имени берём начало email. */
export function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name || "").trim();
  if (source) {
    const words = source.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }
  const localPart = (email || "").split("@")[0];
  return localPart ? localPart.slice(0, 2).toUpperCase() : "?";
}

export function UserAvatar({ size = 28, className = "" }: UserAvatarProps) {
  const { data: session, status } = useSession();

  const radius = Math.round(size * 0.32);
  const boxStyle = { width: size, height: size, borderRadius: radius };

  // Ключевой момент: во время загрузки НИЧЕГО не угадываем. Любая попытка
  // показать инициалы или картинку здесь и приводила к мельканию.
  if (status === "loading") {
    return (
      <div
        aria-hidden
        className={`animate-pulse bg-[#eeeae3] ${className}`}
        style={boxStyle}
      />
    );
  }

  const name = session?.user?.name || "";
  const email = session?.user?.email || "";
  const image = session?.user?.image || null;
  const initials = initialsFrom(name, email);

  return (
    <Avatar
      className={`border border-[#d9d2c8] bg-white shadow-sm ${className}`}
      style={boxStyle}
    >
      {/* Рендерим только при реальном URL: несуществующий src — это 404,
          лишний сетевой запрос и мигание фолбэка. */}
      {image && <AvatarImage src={image} alt={name || email || "Профиль"} />}
      <AvatarFallback
        className="bg-[#fff7e8] font-semibold text-[#8a5b2b]"
        style={{ borderRadius: radius, fontSize: Math.max(9, Math.round(size * 0.34)) }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
