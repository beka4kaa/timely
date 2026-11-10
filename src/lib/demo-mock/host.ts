// Публичное демо: тот же сайт на поддомене demo, но без сервера.
//
// На этом хосте приложение не ходит ни в бэкенд, ни в авторизацию: все запросы
// перехватывает src/lib/demo-mock/install.ts и отвечает выдуманными данными из
// public/demo/fixtures.json. Определяется по имени хоста во время работы, а не при
// сборке: один и тот же деплой обслуживает и app, и demo.

export const DEFAULT_DEMO_HOST = "demo.timely-plan.study";

/** Хост демо. Для локального стенда задаётся `NEXT_PUBLIC_DEMO_HOST=demo.localhost`. */
export const DEMO_HOST = (process.env.NEXT_PUBLIC_DEMO_HOST || DEFAULT_DEMO_HOST).trim().toLowerCase();

export function isDemoHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return hostname.trim().toLowerCase().replace(/\.$/, "") === DEMO_HOST;
}

/** В браузере: открыт ли сейчас сайт на хосте демо. */
export function inDemoBrowser(): boolean {
  return typeof window !== "undefined" && isDemoHost(window.location.hostname);
}
