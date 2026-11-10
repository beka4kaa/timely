// Относительный путь, а не «@/»: файл проверяют тесты на ts-node без алиасов.
import { IS_DEMO } from "../../lib/demo-mode";

const PRODUCTION_APP_URL = "https://app.timely-plan.study";

function origin(value: string | undefined): string {
  return value?.trim().replace(/\/$/, "") ?? "";
}

/**
 * Куда ведут «Открыть», «Войти» и остальные ссылки лендинга в приложение.
 *
 * В сборке демо приложение — это само демо: кнопка не должна уводить проверяющего
 * в настоящий кабинет, где нужна регистрация. Там берётся адрес демо, а без него —
 * относительная ссылка на тот же сайт.
 */
export function resolveAppUrl(env: { appUrl?: string; demoUrl?: string; isDemo: boolean }): string {
  const explicit = origin(env.appUrl);
  if (env.isDemo) {
    // Явный адрес приложения в демо годится, только если это не продакшен.
    if (explicit && explicit !== PRODUCTION_APP_URL) return explicit;
    return origin(env.demoUrl);
  }
  return explicit || PRODUCTION_APP_URL;
}

export const APP_URL = resolveAppUrl({
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  demoUrl: process.env.NEXT_PUBLIC_DEMO_URL,
  isDemo: IS_DEMO,
});

export const appLink = (path = "") => `${APP_URL}${path}` || "/";

/**
 * Демо для проверяющих: готовый аккаунт ученицы и тур, без регистрации.
 * Ссылки на него появляются, только когда адрес задан (`NEXT_PUBLIC_DEMO_URL`,
 * например https://demo.timely-plan.study): пока демо не запущено, ссылка вела бы в никуда.
 */
export const DEMO_URL: string | null = origin(process.env.NEXT_PUBLIC_DEMO_URL) || null;
