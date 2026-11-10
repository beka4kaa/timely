import type { Metadata } from "next"
import { AuthGuard } from "@/components/auth-guard"
import { PomodoroAlerts } from "@/components/pomodoro/pomodoro-alerts"
import { PomodoroSync } from "@/components/pomodoro/pomodoro-sync"
import { IconSprite } from "@/components/shell/icons"
import { Mascot } from "@/components/shell/mascot/mascot"
import { QuickProvider } from "@/components/shell/quick/quick-context"
import { Sidebar } from "@/components/shell/sidebar"
import { TabBar } from "@/components/shell/tab-bar"
import { ViewTracker } from "@/components/shell/view-tracker"
import { ActiveSubjectProvider } from "@/contexts/active-subject"
import { ActiveScheduleProvider } from "@/contexts/active-schedule"
import { AskRailProvider } from "@/contexts/ask-rail"
import { DashboardShellProvider } from "@/contexts/dashboard-shell"
import { DashboardMain } from "@/components/tutor-rail/dashboard-main"
import { DemoMount } from "@/components/demo/demo-mount"
import { IS_DEMO } from "@/lib/demo-mode"
import { SubjectAskRail } from "@/components/tutor-rail/subject-ask-rail"
import "@/styles/timely/index.css"

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

// Свёрнутая панель применяется до первой отрисовки, иначе она моргала бы на каждой загрузке.
const NAV_BOOT = `try{if(localStorage.getItem("timely-nav")==="collapsed")document.documentElement.classList.add("nav-collapsed")}catch(e){}`

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
    <script dangerouslySetInnerHTML={{ __html: NAV_BOOT }} />
    <AuthGuard requireAuth={true}>
        <ActiveSubjectProvider>
        <ActiveScheduleProvider>
        <AskRailProvider>
        <QuickProvider>
        <DashboardShellProvider>
        <div className="timely-dashboard-shell">
          <IconSprite />
          <div className="scene" aria-hidden="true" />
          {/* Секундный тик помодоро и отправка завершённых сессий. Живёт в layout,
              чтобы таймер шёл на всех страницах. */}
          <PomodoroSync />
          {/* Отсчёт во вкладке, звонок, уведомления и «Пора на перерыв» на любой странице. */}
          <PomodoroAlerts />
          <ViewTracker />
          <Sidebar />
          <DashboardMain>{children}</DashboardMain>
          <Mascot />
          {/* Мини-окно внизу. На «Плане» это помощник по расписанию, на остальных
              страницах вопросы тьютору; выбор режима внутри. */}
          <SubjectAskRail />
          <TabBar />
          {/* Демо для проверяющих: плашка и тур. Вне сборки демо не рендерится. */}
          {IS_DEMO ? <DemoMount /> : null}
        </div>
        </DashboardShellProvider>
        </QuickProvider>
        </AskRailProvider>
        </ActiveScheduleProvider>
        </ActiveSubjectProvider>
    </AuthGuard>
    </>
  )
}
