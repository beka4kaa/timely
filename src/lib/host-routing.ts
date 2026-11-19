export const DEFAULT_MARKETING_HOSTNAME = "timely-plan.com";
export const DEFAULT_APP_HOSTNAME = "app.timely-plan.com";
export const DEFAULT_APP_ORIGIN = `https://${DEFAULT_APP_HOSTNAME}`;

/**
 * Прошлые домены Timely. Любой их адрес уводится на тот же раздел нынешнего
 * домена: app — в приложение, demo — в демо, остальное — на сайт-визитку.
 */
export const LEGACY_BASE_DOMAINS = ["timely-plan.study", "timelyplan.me"];

export interface HostRoutingConfig {
  marketingHostname: string;
  appHostname: string;
  appOrigin: string;
  /** Без него — https:// плюс marketingHostname. */
  marketingOrigin?: string;
  /**
   * Публичное демо: тот же кабинет на чистых адресах, но без входа. Данные там
   * подставляет браузер (src/lib/demo-mock), сервер в демо не участвует.
   */
  demoHostname?: string;
}

export interface HostRoutingInput {
  hostname: string;
  pathname: string;
  search?: string;
}

export type HostRoutingAction =
  | { type: "next" }
  | { type: "rewrite"; pathname: string }
  | { type: "redirect"; destination: string; status: 302 | 308 };

export const DEFAULT_HOST_ROUTING_CONFIG: HostRoutingConfig = {
  marketingHostname: DEFAULT_MARKETING_HOSTNAME,
  appHostname: DEFAULT_APP_HOSTNAME,
  appOrigin: DEFAULT_APP_ORIGIN,
};

const APP_PASSTHROUGH_PREFIXES = [
  "/api",
  "/auth",
  "/register",
  "/privacy",
  // Разговор по публичной ссылке: открывается без входа и без приставки дашборда.
  "/share",
  "/_next",
];

export function normalizeHostname(value: string | null | undefined): string {
  const firstHost = value?.split(",")[0]?.trim();
  if (!firstHost) return "";

  try {
    return new URL(`http://${firstHost}`).hostname
      .toLocaleLowerCase("en-US")
      .replace(/\.$/, "");
  } catch {
    return firstHost
      .replace(/:\d+$/, "")
      .toLocaleLowerCase("en-US")
      .replace(/\.$/, "");
  }
}

export function getRequestHostname(headers: Headers): string {
  return normalizeHostname(
    headers.get("x-forwarded-host") ?? headers.get("host"),
  );
}

export function isAppHostname(
  hostname: string,
  config: HostRoutingConfig = DEFAULT_HOST_ROUTING_CONFIG,
): boolean {
  return normalizeHostname(hostname) === normalizeHostname(config.appHostname);
}

export function isMarketingHostname(
  hostname: string,
  config: HostRoutingConfig = DEFAULT_HOST_ROUTING_CONFIG,
): boolean {
  const normalized = normalizeHostname(hostname);
  const marketing = normalizeHostname(config.marketingHostname);
  return normalized === marketing || normalized === `www.${marketing}`;
}

export function isAppPassthroughPath(pathname: string): boolean {
  if (/\.[^/]+$/.test(pathname)) return true;

  return APP_PASSTHROUGH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Страницы, которые есть только на сайте-визитке: английский лендинг. На app-хосте
 * такой адрес иначе превратился бы в несуществующий раздел `/dashboard/en`.
 */
const MARKETING_ONLY_PREFIXES = ["/en"];

export function isMarketingOnlyPath(pathname: string): boolean {
  return MARKETING_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function marketingOriginOf(config: HostRoutingConfig): string {
  return (config.marketingOrigin ?? `https://${config.marketingHostname}`).replace(/\/$/, "");
}

/**
 * Адрес сайта-визитки из тех же переменных, что читает middleware. Значения по
 * умолчанию — только запасной вариант: в продакшене хосты задаёт окружение.
 */
export function marketingOriginFromEnv(): string {
  return marketingOriginOf({
    marketingHostname: process.env.TIMELY_MARKETING_HOST ?? DEFAULT_MARKETING_HOSTNAME,
    marketingOrigin: process.env.TIMELY_MARKETING_ORIGIN,
    appHostname: process.env.TIMELY_APP_HOST ?? DEFAULT_APP_HOSTNAME,
    appOrigin: process.env.TIMELY_APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
  });
}

/**
 * Куда уводить запрос на прошлый домен: origin без пути или null, если хост не
 * старый. Хост из нынешней настройки не уводится никогда — пока окружение ещё
 * указывает на старый домен, это была бы петля.
 */
export function legacyHostRedirectOrigin(
  hostname: string,
  config: HostRoutingConfig = DEFAULT_HOST_ROUTING_CONFIG,
): string | null {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  if (
    isMarketingHostname(host, config) ||
    isAppHostname(host, config) ||
    (!!config.demoHostname && host === normalizeHostname(config.demoHostname))
  ) {
    return null;
  }

  const base = LEGACY_BASE_DOMAINS.find(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!base) return null;

  const label = host === base ? "" : host.slice(0, -(base.length + 1));
  if (label === "app") return config.appOrigin.replace(/\/$/, "");
  if (label === "demo" && config.demoHostname) {
    return `https://${normalizeHostname(config.demoHostname)}`;
  }
  return marketingOriginOf(config);
}

export function dashboardPathToAppPath(pathname: string): string {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "/";

  const cleanPath = pathname.replace(/^\/dashboard/, "");
  return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
}

export function appPathToDashboardPath(pathname: string): string {
  if (pathname === "/") {
    // Корень приложения — «Сейчас», он же `/dashboard`. Адрес в строке
    // остаётся «/», без внутреннего редиректа.
    return "/dashboard";
  }

  const normalizedPath = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;
  return `/dashboard${normalizedPath}`;
}

/**
 * Канонический адрес раздела по тому, что видно в адресной строке.
 *
 * На app-хосте адреса чистые: `/chat`, `/diary`, — а `/dashboard/...` живёт
 * только внутри, после `NextResponse.rewrite`. `usePathname()` в браузере
 * отдаёт именно адресную строку, поэтому всякое сравнение вида
 * `pathname === "/dashboard/chat"` там молча ложно: заголовок раздела
 * оставался «Рабочим пространством», подсветка пункта меню не зажигалась, а
 * панель вопросов не исчезала со страниц, где ей нельзя быть.
 *
 * Приводить адрес к каноническому виду должен КАЖДЫЙ, кто по нему что-то
 * решает, — для этого есть хук `useDashboardPath`.
 */
export function toDashboardPath(pathname: string): string {
  if (!pathname) return "/dashboard";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return pathname;
  }
  // `/auth/...`, `/register`, `/privacy`, файлы — это не разделы дашборда, и приставка
  // сделала бы из них несуществующие страницы.
  if (isAppPassthroughPath(pathname)) return pathname;
  return appPathToDashboardPath(pathname);
}

export function resolveHostRouting(
  input: HostRoutingInput,
  config: HostRoutingConfig = DEFAULT_HOST_ROUTING_CONFIG,
): HostRoutingAction {
  const search = input.search?.startsWith("?")
    ? input.search
    : input.search
      ? `?${input.search}`
      : "";

  const legacyOrigin = legacyHostRedirectOrigin(input.hostname, config);
  if (legacyOrigin) {
    return {
      type: "redirect",
      destination: `${legacyOrigin}${input.pathname}${search}`,
      status: 308,
    };
  }

  if (
    isMarketingHostname(input.hostname, config) &&
    (input.pathname === "/dashboard" ||
      input.pathname.startsWith("/dashboard/"))
  ) {
    const cleanPath = dashboardPathToAppPath(input.pathname);
    return {
      type: "redirect",
      destination: `${config.appOrigin.replace(/\/$/, "")}${cleanPath}${search}`,
      status: 302,
    };
  }

  const onDemo =
    !!config.demoHostname &&
    normalizeHostname(input.hostname) === normalizeHostname(config.demoHostname);
  // Кабинет на демо живёт по тем же правилам, что на app. Его переадресации
  // относительные: middleware достраивает их от адреса самого запроса, так что
  // демо работает и на https в проде, и на http://demo.localhost у стенда.
  const origin = onDemo ? "" : config.appOrigin;

  if (!isAppHostname(input.hostname, config) && !onDemo) {
    return { type: "next" };
  }

  // Входа в демо нет: сессию и данные подставляет браузер.
  if (
    onDemo &&
    (input.pathname === "/auth" ||
      input.pathname.startsWith("/auth/") ||
      input.pathname === "/register" ||
      input.pathname.startsWith("/register/"))
  ) {
    return { type: "redirect", destination: "/", status: 302 };
  }

  if (isMarketingOnlyPath(input.pathname)) {
    return {
      type: "redirect",
      destination: `${marketingOriginOf(config)}${input.pathname}${search}`,
      status: 302,
    };
  }

  if (isAppPassthroughPath(input.pathname)) {
    return { type: "next" };
  }

  if (
    input.pathname === "/dashboard" ||
    input.pathname.startsWith("/dashboard/")
  ) {
    const cleanPath = dashboardPathToAppPath(input.pathname);
    return {
      type: "redirect",
      destination: `${origin.replace(/\/$/, "")}${cleanPath}${search}`,
      status: 302,
    };
  }

  return {
    type: "rewrite",
    pathname: appPathToDashboardPath(input.pathname),
  };
}
