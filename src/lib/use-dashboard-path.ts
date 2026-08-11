"use client";

// Адрес текущего раздела в каноническом виде — `/dashboard/...`.
//
// На app-хосте адресная строка чистая (`/chat`, `/diary`), а `/dashboard/...`
// появляется только внутри, после `rewrite` в middleware. `usePathname()`
// отдаёт адресную строку, поэтому голое сравнение с `/dashboard/chat` там
// всегда ложно.
//
// Всё, что решает по адресу — заголовок раздела, подсветка пункта меню,
// список страниц без панели вопросов, — обязано брать путь отсюда, а не из
// `usePathname()` напрямую.

import { usePathname } from "next/navigation";

import { toDashboardPath } from "./host-routing";

export function useDashboardPath(): string {
  // `usePathname()` типизирован как строка, но во время первого рендера в
  // некоторых контекстах отдаёт `null`. Пустая строка приводится к `/dashboard`.
  return toDashboardPath(usePathname() ?? "");
}
