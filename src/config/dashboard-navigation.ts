import type { LucideIcon } from "lucide-react";
import {
  AwardIcon,
  CalendarIcon,
  ChartLineIcon,
  ClipboardCheckIcon,
  GraduationCapIcon,
  LibraryIcon,
  MedalIcon,
  MessagesSquareIcon,
  NotebookPenIcon,
  PresentationIcon,
  SwordsIcon,
  TimerIcon,
  TrophyIcon,
  ZapIcon,
} from "lucide-react";

import { NowIcon } from "./nav-icons.ts";

export interface DashboardNavigationAccess {
  is_admin?: boolean;
  is_moderator?: boolean;
  is_staff?: boolean;
}

export interface DashboardNavigationItem {
  title: string;
  url: string;
  icon: LucideIcon;
  access?: "admin" | "moderator";
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
    title: "План недели",
    subtitle: "Программа, разложенная по дням и часам",
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
    title: "Карта целей",
    subtitle: "Планы, связи и прогресс",
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
  | "study"
  | "tutor"
  | "library"
  | "contests"
  | "progress";

/**
 * Раздел верхнего уровня — то, что стоит в рейле и в нижней панели телефона.
 *
 * Шесть разделов из CLAUDE.md §16. Страниц внутри больше, и они живут в
 * `items`: рейл показывает их, когда раскрыт, а сам раздел ведёт на первую.
 */
export interface DashboardSection {
  key: DashboardSectionKey;
  title: string;
  icon: LucideIcon;
  url: string;
  items: DashboardNavigationItem[];
}

const dashboardSections: DashboardSection[] = [
  {
    key: "now",
    title: "Сейчас",
    icon: NowIcon,
    url: "/dashboard",
    items: [],
  },
  {
    key: "study",
    title: "Учёба",
    icon: NotebookPenIcon,
    url: "/dashboard/diary",
    items: [
      { title: "Дневник", url: "/dashboard/diary", icon: NotebookPenIcon },
      { title: "План недели", url: "/dashboard/plan", icon: CalendarIcon },
      { title: "Слабые темы", url: "/dashboard/weaknesses", icon: ZapIcon },
    ],
  },
  {
    key: "tutor",
    title: "Тьютор",
    icon: MessagesSquareIcon,
    url: "/dashboard/chat",
    items: [
      { title: "Чат по книге", url: "/dashboard/chat", icon: MessagesSquareIcon },
      {
        title: "Научная доска",
        url: "/dashboard/whiteboard",
        icon: PresentationIcon,
      },
    ],
  },
  {
    key: "library",
    title: "Библиотека",
    icon: LibraryIcon,
    url: "/dashboard/curriculum",
    items: [],
  },
  {
    key: "contests",
    title: "Соревнования",
    icon: TrophyIcon,
    url: "/dashboard/arena/solve",
    items: [
      { title: "Контесты", url: "/dashboard/arena/solve", icon: SwordsIcon },
      { title: "Арена", url: "/dashboard/arena/review", icon: ClipboardCheckIcon },
      { title: "Рейтинг", url: "/dashboard/leaderboard", icon: MedalIcon },
      { title: "Достижения", url: "/dashboard/achievements", icon: AwardIcon },
    ],
  },
  {
    key: "progress",
    title: "Прогресс",
    icon: ChartLineIcon,
    // Отдельной страницы прогресса пока нет; ближе всего к нему — оценки за
    // четверть и год. Таймер — второй, со своей статистикой фокуса.
    url: "/dashboard/diary/grades",
    items: [
      {
        title: "Итоговые оценки",
        url: "/dashboard/diary/grades",
        icon: GraduationCapIcon,
      },
      { title: "Помодоро", url: "/dashboard/pomodoro", icon: TimerIcon },
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
export function matchNavigation(pathname: string): NavigationMatch {
  let best: { section: DashboardSectionKey; itemUrl: string; length: number } | null =
    null;
  for (const section of dashboardSections) {
    const candidates = section.items.length
      ? section.items.map((item) => item.url)
      : [section.url];
    for (const url of candidates) {
      if (!matches(pathname, url)) continue;
      if (!best || url.length > best.length) {
        best = { section: section.key, itemUrl: url, length: url.length };
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
