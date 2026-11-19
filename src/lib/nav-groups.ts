// Раскрытые группы левой панели и сигналы на строке группы.
//
// Одно состояние на компьютер и телефон: на телефоне выезжает та же панель. Пока ничего
// не запомнено, открыта только группа текущей страницы, чтобы панель сразу была короткой.

import type { DashboardSection, DashboardSectionKey } from "../config/dashboard-navigation.ts";

export const NAV_GROUPS_KEY = "timely-nav-groups";

/** Какие группы открыть: запомненные (только известные) плюс группа текущей страницы. */
export function openGroupsFor(
  saved: readonly string[] | null,
  current: DashboardSectionKey | null,
  groups: readonly DashboardSectionKey[],
): DashboardSectionKey[] {
  const open = (saved ?? []).filter((key): key is DashboardSectionKey =>
    (groups as readonly string[]).includes(key),
  );
  if (current && groups.includes(current) && !open.includes(current)) open.push(current);
  return open;
}

export function toggleGroup(
  open: readonly DashboardSectionKey[],
  key: DashboardSectionKey,
): DashboardSectionKey[] {
  return open.includes(key) ? open.filter((item) => item !== key) : [...open, key];
}

/**
 * Что показать на строке свёрнутой группы: число тем на повторение и точку, пока
 * обрабатывается книга. Те же сигналы, что у самих пунктов, когда группа раскрыта.
 */
export function groupSignal(
  section: DashboardSection,
  status: { dueReviews: number; ingesting: boolean },
): { count: number | null; live: boolean } {
  const has = (url: string) => section.items.some((item) => item.url === url);
  return {
    count: has("/dashboard/weaknesses") && status.dueReviews > 0 ? status.dueReviews : null,
    live: has("/dashboard/curriculum") && status.ingesting,
  };
}

/** Запомненные группы; `null` — записи нет, хранилище закрыто или в нём мусор. */
export function readOpenGroups(): string[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(NAV_GROUPS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function writeOpenGroups(open: readonly DashboardSectionKey[]): void {
  try {
    globalThis.localStorage?.setItem(NAV_GROUPS_KEY, JSON.stringify(open));
  } catch {
    // Приватный режим: группы раскрываются, просто не запоминаются.
  }
}
