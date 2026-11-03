import type { Metadata } from "next"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { AuthGuard } from "@/components/auth-guard"
import { PomodoroSync } from "@/components/pomodoro/pomodoro-sync"
import { DiaryHeaderProvider } from "@/contexts/diary-header-ctx"
import { ActiveSubjectProvider } from "@/contexts/active-subject"
import { ActiveScheduleProvider } from "@/contexts/active-schedule"
import { AskRailProvider } from "@/contexts/ask-rail"
import { DashboardShellProvider } from "@/contexts/dashboard-shell"
import { MobileTabBar } from "@/components/nav/mobile-tab-bar"
import { DashboardMain } from "@/components/tutor-rail/dashboard-main"
import { SubjectAskRail } from "@/components/tutor-rail/subject-ask-rail"

export const metadata: Metadata = {
  title: {
    // Страницы раздела в основном клиентские и своего заголовка не задают —
    // им достаётся имя продукта, а не чужой раздел.
    default: "Timely",
    template: "%s | Timely",
  },
  description: "Личный кабинет TimelyPlan: дневник, цели, расписание, привычки и учебные инструменты.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard requireAuth={true}>
      <DiaryHeaderProvider>
        <ActiveSubjectProvider>
        <ActiveScheduleProvider>
        <AskRailProvider>
        <DashboardShellProvider>
        {/* Цвета — токены из globals.css (светлая и тёмная тема), без
            локальных переопределений. */}
        <div className="timely-dashboard-shell relative h-screen w-full overflow-hidden bg-tm-bg text-tm-ink">
          {/* Секундный тик помодоро и отправка завершённых сессий.
              Живёт в layout, чтобы таймер шёл на всех страницах дашборда. */}
          <PomodoroSync />
          <SiteHeader />
          <AppSidebar />
          <DashboardMain>{children}</DashboardMain>
          {/* Разговор справа. Живёт в layout по той же причине, что и
              PomodoroSync: панель нужна на любой странице дашборда. Открытая,
              она сдвигает `DashboardMain`, а не ложится поверх, — так же, как
              чат доски сдвигает холст.

              На «Плане» это помощник по расписанию, на остальных страницах —
              вопросы по книге предмета; выбор режима внутри самой панели. */}
          <SubjectAskRail />
          {/* Разделы на телефоне: на ≥768 px их показывает рейл слева. */}
          <MobileTabBar />
        </div>
        </DashboardShellProvider>
        </AskRailProvider>
        </ActiveScheduleProvider>
        </ActiveSubjectProvider>
      </DiaryHeaderProvider>
    </AuthGuard>
  )
}
