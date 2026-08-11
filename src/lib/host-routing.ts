export const DEFAULT_MARKETING_HOSTNAME = "timelyplan.me";
export const DEFAULT_APP_HOSTNAME = "app.timelyplan.me";
export const DEFAULT_APP_ORIGIN = `https://${DEFAULT_APP_HOSTNAME}`;

export interface HostRoutingConfig {
  marketingHostname: string;
  appHostname: string;
  appOrigin: string;
}

export interface HostRoutingInput {
  hostname: string;
  pathname: string;
  search?: string;
}

export type HostRoutingAction =
  | { type: "next" }
  | { type: "rewrite"; pathname: string }
  | { type: "redirect"; destination: string; status: 302 };

export const DEFAULT_HOST_ROUTING_CONFIG: HostRoutingConfig = {
  marketingHostname: DEFAULT_MARKETING_HOSTNAME,
  appHostname: DEFAULT_APP_HOSTNAME,
  appOrigin: DEFAULT_APP_ORIGIN,
};

const APP_PASSTHROUGH_PREFIXES = [
  "/api",
  "/auth",
  "/register",
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

export function dashboardPathToAppPath(pathname: string): string {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "/";

  const cleanPath = pathname.replace(/^\/dashboard/, "");
  return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
}

export function appPathToDashboardPath(pathname: string): string {
  if (pathname === "/") {
    // /dashboard currently resolves to the diary. Rewriting directly keeps the
    // public app URL at "/" instead of exposing the internal redirect target.
    return "/dashboard/diary";
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
  // `/auth/...`, `/register`, файлы — это не разделы дашборда, и приставка
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

  if (!isAppHostname(input.hostname, config)) {
    return { type: "next" };
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
      destination: `${config.appOrigin.replace(/\/$/, "")}${cleanPath}${search}`,
      status: 302,
    };
  }

  return {
    type: "rewrite",
    pathname: appPathToDashboardPath(input.pathname),
  };
}
