// Тиры и рисунки плашек контестов. Потолки те же, что на сервере (accounts/contest_rules.py):
// поменяли там, поменяй и здесь, тесты обеих сторон держат одни и те же числа.

import { msg, t } from "./i18n";
import type { ContestArtName, ContestTier, Me } from "./contest-api";

export interface TierMeta {
  tier: ContestTier;
  name: string;
  /** Сколько баллов максимум дают все задачи контеста вместе. */
  cap: number;
  /** Класс цвета плашки: `.tier-1 … .tier-5` в page-compete.css. */
  className: string;
}

export const TIERS: readonly TierMeta[] = [
  { tier: 1, name: msg("Аметист"), cap: 800, className: "tier-1" },
  { tier: 2, name: msg("Алмаз"), cap: 400, className: "tier-2" },
  { tier: 3, name: msg("Золото"), cap: 200, className: "tier-3" },
  { tier: 4, name: msg("Серебро"), cap: 100, className: "tier-4" },
  { tier: 5, name: msg("Бронза"), cap: 50, className: "tier-5" },
];

/** Незнакомый тир считается бронзой: так старые данные не ломают плашку. */
export function tierMeta(tier: number): TierMeta {
  const row = TIERS.find((item) => item.tier === tier) ?? TIERS[TIERS.length - 1];
  return { ...row, name: t(row.name) };
}

/** Тиры 1 и 2 раздают много баллов разом, поэтому их ставит только владелец. */
export const OWNER_ONLY_TIERS: readonly ContestTier[] = [1, 2];

export function canSetTier(me: Pick<Me, "is_staff"> | null | undefined, tier: number): boolean {
  return !OWNER_ONLY_TIERS.includes(tier as ContestTier) || Boolean(me?.is_staff);
}

export const ARTS: readonly { name: ContestArtName; label: string }[] = [
  { name: "rings", label: msg("Кольца") },
  { name: "throw", label: msg("Траектории") },
  { name: "orbits", label: msg("Орбиты") },
  { name: "waves", label: msg("Волны") },
  { name: "sun", label: msg("Солнце") },
  { name: "grid", label: msg("Сетка") },
  { name: "cells", label: msg("Соты") },
  { name: "stars", label: msg("Созвездие") },
  { name: "triangles", label: msg("Треугольники") },
  { name: "spiral", label: msg("Спираль") },
  { name: "steps", label: msg("Столбики") },
  { name: "code", label: msg("Код") },
];

export function artOf(name: string): ContestArtName {
  return ARTS.find((row) => row.name === name)?.name ?? "rings";
}
