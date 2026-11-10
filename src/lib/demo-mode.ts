/**
 * Демо для проверяющих: demo.timely-plan.study.
 *
 * Это отдельный проект Vercel со своим бэкендом и своей базой. Публичный флаг
 * вшивается в сборку, но middleware всё равно сверяет его при каждом запросе, так
 * что ветки демо остаются в коде и спят, пока флага нет. Вход без пароля требует
 * ещё и серверного `DEMO_MODE` (см. `isDemoServer`).
 *
 * Оба флага ставятся только вместе и только на демо-проекте. Один публичный флаг
 * на продакшене отправил бы всех без сессии на /auth/demo, где нет провайдера, и
 * войти не смог бы никто.
 */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true"

/** Куда отправлять человека без сессии. В демо вместо входа — заведение гостя. */
export const SIGN_IN_PATH = IS_DEMO ? "/auth/demo" : "/auth/signin"

export const DEMO_VISITOR_DOMAIN = "demo.timely-plan.study"

/** Имя ученицы, в чей аккаунт попадает гость. Совпадает с сюжетом на бэкенде. */
export const DEMO_STUDENT_NAME = "Алия"

export function isDemoServer(): boolean {
  return IS_DEMO && process.env.DEMO_MODE === "true"
}

/** Новый гость. Бэкенд принимает в демо только такие адреса. */
export function newDemoVisitor(uuid: string = globalThis.crypto.randomUUID()) {
  return {
    id: `demo-${uuid}`,
    email: `visitor-${uuid}@${DEMO_VISITOR_DOMAIN}`,
    name: DEMO_STUDENT_NAME,
  }
}

/**
 * Куда вести гостя после заведения. Только свой относительный адрес и не страницы
 * входа, иначе ссылка вида `?callbackUrl=https://…` увела бы его на чужой сайт.
 */
export function demoLandingPath(callbackUrl: string | null | undefined): string {
  const raw = (callbackUrl ?? "").trim()
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/"
  if (raw === "/auth" || raw.startsWith("/auth/") || raw.startsWith("/api/")) return "/"
  return raw
}

/** Адрес с флагом запуска тура, с сохранением чужих параметров. */
export function withTourFlag(path: string): string {
  const [base, hash = ""] = path.split("#", 2)
  const joiner = base.includes("?") ? "&" : "?"
  return `${base}${joiner}tour=1${hash ? `#${hash}` : ""}`
}

export type DemoLang = "en" | "ru"

/** Русский тем, у кого в браузере русский или казахский; остальным английский. */
export function pickDemoLang(languages: readonly string[] | undefined): DemoLang {
  for (const tag of languages ?? []) {
    const base = tag.toLowerCase().split("-")[0]
    if (base === "ru" || base === "kk") return "ru"
  }
  return "en"
}
