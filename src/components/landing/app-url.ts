export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "https://app.timely-plan.study";

export const appLink = (path = "") => `${APP_URL}${path}`;

/**
 * Демо для проверяющих: готовый аккаунт ученицы и тур, без регистрации.
 * Ссылки на него появляются, только когда адрес задан (`NEXT_PUBLIC_DEMO_URL`,
 * например https://demo.timely-plan.study): пока демо не запущено, ссылка вела бы в никуда.
 */
export const DEMO_URL: string | null =
  process.env.NEXT_PUBLIC_DEMO_URL?.trim().replace(/\/$/, "") || null;
