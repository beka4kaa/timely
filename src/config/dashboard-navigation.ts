import type { LucideIcon } from "lucide-react";
import {
  AppleIcon,
  BookOpenIcon,
  CheckSquareIcon,
  EyeIcon,
  FlameIcon,
  GraduationCapIcon,
  HeartIcon,
  LayoutDashboardIcon,
  MedalIcon,
  NotebookPenIcon,
  ShieldCheckIcon,
  SwordsIcon,
  TargetIcon,
  TimerIcon,
  TrophyIcon,
  ZapIcon,
} from "lucide-react";

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
    title: "Рабочее пространство",
    subtitle: "Все учебные инструменты в одном месте",
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
    title: "Contests",
    subtitle: "Соревнования и новые задачи",
  },
  "/dashboard/arena/review": {
    title: "Arena Review",
    subtitle: "Взаимная проверка решений",
  },
  "/dashboard/leaderboard": {
    title: "Leaderboard",
    subtitle: "Рейтинг участников Timely",
  },
  "/dashboard/achievements": {
    title: "Achievements",
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

const dashboardNavigation: DashboardNavigationGroup[] = [
  {
    label: "Главное",
    items: [
      { title: "Дневник", url: "/dashboard/diary", icon: NotebookPenIcon },
      { title: "Доска", url: "/dashboard/whiteboard", icon: LayoutDashboardIcon },
      { title: "Помодоро", url: "/dashboard/pomodoro", icon: TimerIcon },
      { title: "Задачи", url: "/dashboard/tasks", icon: CheckSquareIcon },
    ],
  },
  {
    label: "Личное",
    items: [
      { title: "Привычки", url: "/dashboard/habits", icon: FlameIcon },
      { title: "Карта целей", url: "/dashboard/goals", icon: TargetIcon },
      { title: "Калории и БЖУ", url: "/dashboard/nutrition", icon: AppleIcon },
    ],
  },
  {
    label: "Учёба",
    items: [
      { title: "Предметы", url: "/dashboard/subjects", icon: GraduationCapIcon },
      { title: "Слабые темы", url: "/dashboard/weaknesses", icon: ZapIcon },
      { title: "Программа", url: "/dashboard/program", icon: BookOpenIcon },
      { title: "Самостоятельная", url: "/dashboard/self-work", icon: HeartIcon },
    ],
  },
  {
    label: "Сообщество",
    items: [
      { title: "Contests", url: "/dashboard/arena/solve", icon: SwordsIcon },
      {
        title: "Arena (Review)",
        url: "/dashboard/arena/review",
        icon: EyeIcon,
      },
      { title: "Leaderboard", url: "/dashboard/leaderboard", icon: MedalIcon },
      { title: "Achievements", url: "/dashboard/achievements", icon: TrophyIcon },
    ],
  },
  {
    label: "Управление",
    items: [
      {
        title: "Админ-панель",
        url: "/dashboard/admin",
        icon: ShieldCheckIcon,
        access: "admin",
      },
    ],
  },
];

// Routes stay available in the application, while the sidebar intentionally
// exposes only the compact set selected for the current product navigation.
const visibleNavigationRoutes = new Set([
  "/dashboard/diary",
  "/dashboard/whiteboard",
  "/dashboard/pomodoro",
  "/dashboard/arena/solve",
  "/dashboard/arena/review",
  "/dashboard/leaderboard",
  "/dashboard/achievements",
]);

function canSeeItem(
  item: DashboardNavigationItem,
  access?: DashboardNavigationAccess | null,
) {
  if (!item.access) return true;
  if (item.access === "admin") return Boolean(access?.is_admin);
  return Boolean(access?.is_admin || access?.is_moderator || access?.is_staff);
}

export function getDashboardNavigation(
  access?: DashboardNavigationAccess | null,
): DashboardNavigationGroup[] {
  return dashboardNavigation
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter(
          (item) =>
            visibleNavigationRoutes.has(item.url) && canSeeItem(item, access),
        )
        .map((item) => ({
          title: item.title,
          url: item.url,
          icon: item.icon,
        })),
    }))
    .filter((group) => group.items.length > 0);
}

export function getDashboardPageMeta(pathname: string): DashboardPageMeta {
  const matchingRoute = Object.keys(dashboardPageMeta)
    .sort((a, b) => b.length - a.length)
    .find(
      (route) =>
        pathname === route ||
        (route !== "/dashboard" && pathname.startsWith(`${route}/`)),
    );

  return (
    (matchingRoute ? dashboardPageMeta[matchingRoute] : undefined) ??
    dashboardPageMeta["/dashboard"]
  );
}
