import type { IconName } from "../components/shell/icons";
import { BOARD_ENABLED } from "./features.ts";
import { SECTION_LABEL } from "../lib/curriculum-books.ts";

export interface DashboardNavigationAccess {
  is_admin?: boolean;
  is_moderator?: boolean;
  is_staff?: boolean;
}

export interface DashboardNavigationItem {
  title: string;
  url: string;
  icon: IconName;
  access?: "admin" | "moderator";
  /** Другие адреса, на которых этот пункт тоже горит: страницы, вошедшие в него. */
  aliases?: readonly string[];
}

export interface DashboardNavigationGroup {
  label: string;
  items: DashboardNavigationItem[];
}

export interface DashboardPageMeta {
  title: string;
  subtitle: string;
}

const dashboardPageMeta: Record<string, DashboardPageMeta> = {
  "/dashboard": {
    title: "Сейчас",
    subtitle: "День одной лентой и следующий шаг",
  },
  "/dashboard/diary": {
    title: "Дневник",
    subtitle: "Неделя, уроки и оценки",
  },
  "/dashboard/diary/grades": {
    title: "Итоговые оценки",
    subtitle: "Динамика и результаты учебного года",
  },
  "/dashboard/diary/schedule": {
    title: "Шаблон расписания",
    subtitle: "Настройка учебной недели",
  },
  "/dashboard/whiteboard": {
    title: "Научная доска",
    subtitle: "Учебная сессия · сохраняется автоматически",
  },
  "/dashboard/chat": {
    title: "Тьютор",
    subtitle: "Разбор по вашим книгам со ссылками на страницы",
  },
  "/dashboard/curriculum": {
    title: "Библиотека",
    subtitle: "Программа по вашему учебнику со ссылками на страницы",
  },
  "/dashboard/plan": {
    title: "Неделя",
    subtitle: "Уроки, занятия и задания недели",
  },
  // Ключ длиннее «/dashboard/curriculum», а `getDashboardPageMeta` сортирует
  // ключи по убыванию длины — поэтому он выигрывает. В боковое меню программа
  // не попадает: она открывается по ссылке, а не из списка разделов.
  "/dashboard/curriculum/plan": {
    title: "Программа",
    subtitle: "Модули, темы и страницы учебника",
  },
  "/dashboard/board": {
    title: "Доска",
    subtitle: "Свободное рабочее пространство",
  },
  "/dashboard/tasks": {
    title: "Задачи",
    subtitle: "Фокус и ближайшие действия",
  },
  "/dashboard/pomodoro": {
    title: "Помодоро",
    subtitle: "Фокус-сессии и время учёбы",
  },
  "/dashboard/habits": {
    title: "Привычки",
    subtitle: "Небольшие действия каждый день",
  },
  "/dashboard/goals": {
    title: "Цели",
    subtitle: "Куда идёшь и к какому сроку",
  },
  "/dashboard/settings": {
    title: "Настройки",
    subtitle: "Напоминания и кто меня видит",
  },
  "/dashboard/nutrition": {
    title: "Питание",
    subtitle: "Калории, БЖУ и дневник рациона",
  },
  "/dashboard/subjects": {
    title: "Предметы",
    subtitle: "Учебные направления и материалы",
  },
  "/dashboard/weaknesses": {
    title: "Слабые темы",
    subtitle: "Темы, которым стоит уделить внимание",
  },
  "/dashboard/program": {
    title: "Программа",
    subtitle: "Персональный учебный маршрут",
  },
  "/dashboard/self-work": {
    title: "Самостоятельная",
    subtitle: "Практика и закрепление материала",
  },
  "/dashboard/arena/solve": {
    title: "Контесты",
    subtitle: "Соревнования и новые задачи",
  },
  "/dashboard/arena/review": {
    title: "Арена",
    subtitle: "Взаимная проверка решений",
  },
  "/dashboard/leaderboard": {
    title: "Рейтинг",
    subtitle: "Рейтинг участников Timely",
  },
  "/dashboard/achievements": {
    title: "Достижения",
    subtitle: "Личная коллекция побед",
  },
  "/dashboard/profile": {
    title: "Профиль",
    subtitle: "Личные данные и настройки",
  },
  "/dashboard/admin": {
    title: "Админ-панель",
    subtitle: "Управление заданиями и доступом",
  },
  "/dashboard/calendar": {
    title: "Календарь",
    subtitle: "События и учебный ритм",
  },
  "/dashboard/history": {
    title: "История",
    subtitle: "Предыдущие учебные дни",
  },
  "/dashboard/review": {
    title: "Повторение",
    subtitle: "Закрепление пройденного материала",
  },
  "/dashboard/schedule": {
    title: "Расписание",
    subtitle: "Учебные блоки и события",
  },
  "/dashboard/study": {
    title: "Учебный план",
    subtitle: "Расписание и история занятий",
  },
  "/dashboard/study-tracker": {
    title: "Трекер обучения",
    subtitle: "Сессии, время и концентрация",
  },
  "/dashboard/ai": {
    title: "AI-анализ",
    subtitle: "Персональные учебные выводы",
  },
  "/dashboard/canvas-test": {
    title: "Canvas Lab",
    subtitle: "Техническое пространство доски",
  },
};

/** Страница без собственной записи: заголовок шапки не должен врать. */
const FALLBACK_META: DashboardPageMeta = {
  title: "Timely",
  subtitle: "Учёба по шагам",
};

export type DashboardSectionKey =
  | "now"
  | "tutor"
  | "study"
  | "growth"
  | "library"
  | "contests";

/**
 * Группа левой панели. «Сейчас» и «Тьютор» идут первыми: это самые важные разделы.
 *
 * На телефоне панели нет, там вкладки «Сейчас», «Тьютор», «Учёба», «Книги» и «Ещё».
 */
export interface DashboardSection {
  key: DashboardSectionKey;
  title: string;
  icon: IconName;
  url: string;
  items: DashboardNavigationItem[];
}

const dashboardSections: DashboardSection[] = [
  {
    key: "now",
    title: "Сейчас",
    icon: "now",
    url: "/dashboard",
    items: [],
  },
  {
    key: "tutor",
    title: "Тьютор",
    icon: "chat",
    url: "/dashboard/chat",
    items: [
      { title: "Чат", url: "/dashboard/chat", icon: "chat" },
      // Доска жжёт токены: в продакшене она выключена, пока не докажет ценность.
      ...(BOARD_ENABLED
        ? ([{ title: "Научная доска", url: "/dashboard/whiteboard", icon: "board" }] as const)
        : []),
    ],
  },
  {
    key: "study",
    title: "Учёба",
    icon: "diary",
    url: "/dashboard/plan",
    items: [
      // Дневник и план стали одной неделей. Шаблон уроков и оценки живут по старым адресам.
      { title: "Неделя", url: "/dashboard/plan", icon: "plan", aliases: ["/dashboard/diary"] },
      { title: "Слабые темы", url: "/dashboard/weaknesses", icon: "target" },
      { title: "Помодоро", url: "/dashboard/pomodoro", icon: "timer" },
    ],
  },
  {
    key: "growth",
    title: "Рост",
    icon: "mountain",
    url: "/dashboard/goals",
    items: [
      { title: "Цели", url: "/dashboard/goals", icon: "mountain" },
      { title: "Привычки", url: "/dashboard/habits", icon: "flame" },
    ],
  },
  {
    key: "library",
    title: "Библиотека",
    icon: "book",
    url: "/dashboard/curriculum",
    items: [{ title: SECTION_LABEL, url: "/dashboard/curriculum", icon: "book" }],
  },
  {
    key: "contests",
    title: "Соревнования",
    icon: "flag",
    url: "/dashboard/arena/solve",
    items: [
      { title: "Контесты", url: "/dashboard/arena/solve", icon: "flag" },
      { title: "Рейтинг", url: "/dashboard/leaderboard", icon: "medal" },
    ],
  },
];

function canSeeItem(
  item: DashboardNavigationItem,
  access?: DashboardNavigationAccess | null,
) {
  if (!item.access) return true;
  if (item.access === "admin") return Boolean(access?.is_admin);
  return Boolean(access?.is_admin || access?.is_moderator || access?.is_staff);
}

export function getDashboardSections(
  access?: DashboardNavigationAccess | null,
): DashboardSection[] {
  return dashboardSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSeeItem(item, access)),
  }));
}

/**
 * Разделы плоскими группами: так их читают меню телефона и мини-рейл доски.
 * У раздела из одной страницы пункт — он сам.
 */
export function getDashboardNavigation(
  access?: DashboardNavigationAccess | null,
): DashboardNavigationGroup[] {
  return getDashboardSections(access).map((section) => ({
    label: section.title,
    items: section.items.length
      ? section.items
      : [{ title: section.title, url: section.url, icon: section.icon }],
  }));
}

function matches(pathname: string, url: string): boolean {
  // «Сейчас» — корень дашборда, и префиксом он совпал бы с любой страницей.
  if (url === "/dashboard") return pathname === "/dashboard";
  return pathname === url || pathname.startsWith(`${url}/`);
}

export interface NavigationMatch {
  section: DashboardSectionKey | null;
  /** Адрес пункта, который подсвечивается внутри раздела. */
  itemUrl: string | null;
}

/**
 * Какой раздел и пункт подсветить для пути.
 *
 * Побеждает самое длинное совпадение: «Итоговые оценки» живут под
 * `/dashboard/diary/grades`, и по префиксу их перехватил бы «Дневник».
 */
/** Горит ли пункт на этой странице: по своему адресу или по одному из прежних. */
export function itemMatches(item: Pick<DashboardNavigationItem, "url" | "aliases">, pathname: string): boolean {
  return [item.url, ...(item.aliases ?? [])].some((url) => matches(pathname, url));
}

export function matchNavigation(pathname: string): NavigationMatch {
  let best: { section: DashboardSectionKey; itemUrl: string; length: number } | null =
    null;
  for (const section of dashboardSections) {
    const candidates = section.items.length
      ? section.items.flatMap((item) => [item.url, ...(item.aliases ?? [])].map((url) => ({ url, itemUrl: item.url })))
      : [{ url: section.url, itemUrl: section.url }];
    for (const { url, itemUrl } of candidates) {
      if (!matches(pathname, url)) continue;
      if (!best || url.length > best.length) {
        best = { section: section.key, itemUrl, length: url.length };
      }
    }
  }
  return best
    ? { section: best.section, itemUrl: best.itemUrl }
    : { section: null, itemUrl: null };
}

export function getDashboardPageMeta(pathname: string): DashboardPageMeta {
  if (pathname === "/dashboard") return dashboardPageMeta["/dashboard"];
  const matchingRoute = Object.keys(dashboardPageMeta)
    .filter((route) => route !== "/dashboard")
    .sort((a, b) => b.length - a.length)
    .find((route) => pathname === route || pathname.startsWith(`${route}/`));

  return (matchingRoute ? dashboardPageMeta[matchingRoute] : undefined) ?? FALLBACK_META;
}

/** Страница для стилей и подсказок: `data-view` на корне документа. */
export type DashboardView =
  | "now"
  | "chat"
  | "board"
  | "diary"
  | "plan"
  | "weak"
  | "focus"
  | "goals"
  | "habits"
  | "library"
  | "course"
  | "contests"
  | "rating"
  | "profile"
  | "prefs"
  | "other";

const VIEW_ROUTES: Array<[string, DashboardView]> = [
  ["/dashboard/curriculum/plan", "course"],
  ["/dashboard/curriculum", "library"],
  ["/dashboard/chat", "chat"],
  ["/dashboard/whiteboard", "board"],
  ["/dashboard/board", "board"],
  ["/dashboard/diary", "diary"],
  ["/dashboard/plan", "plan"],
  ["/dashboard/weaknesses", "weak"],
  ["/dashboard/pomodoro", "focus"],
  ["/dashboard/goals", "goals"],
  ["/dashboard/habits", "habits"],
  ["/dashboard/arena", "contests"],
  ["/dashboard/leaderboard", "rating"],
  ["/dashboard/profile", "profile"],
  ["/dashboard/settings", "prefs"],
];

export function dashboardViewOf(pathname: string): DashboardView {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "now";
  for (const [route, view] of VIEW_ROUTES) {
    if (matches(pathname, route)) return view;
  }
  return "other";
}
