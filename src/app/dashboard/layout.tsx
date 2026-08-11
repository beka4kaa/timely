import type { Metadata } from "next"
import type { CSSProperties } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { AuthGuard } from "@/components/auth-guard"
import { PomodoroSync } from "@/components/pomodoro/pomodoro-sync"
import { DiaryHeaderProvider } from "@/contexts/diary-header-ctx"
import { ActiveSubjectProvider } from "@/contexts/active-subject"
import { ActiveScheduleProvider } from "@/contexts/active-schedule"
import { AskRailProvider } from "@/contexts/ask-rail"
import { DashboardMain } from "@/components/tutor-rail/dashboard-main"
import { SubjectAskRail } from "@/components/tutor-rail/subject-ask-rail"

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s | TimelyPlan",
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
        <div
          className="timely-dashboard-shell relative h-screen w-full overflow-hidden bg-[#f7f5f1] text-[#302d29] [color-scheme:light]"
        style={
          {
              "--background": "42 33% 97%",
              "--foreground": "28 12% 18%",
              "--card": "40 38% 99%",
              "--card-foreground": "28 12% 18%",
              "--popover": "40 38% 99%",
              "--popover-foreground": "28 12% 18%",
              "--primary": "31 44% 37%",
              "--primary-foreground": "40 33% 98%",
              "--secondary": "38 24% 92%",
              "--secondary-foreground": "28 14% 24%",
              "--muted": "38 20% 93%",
              "--muted-foreground": "30 8% 46%",
              "--accent": "38 24% 92%",
              "--accent-foreground": "28 14% 24%",
              "--border": "34 18% 84%",
              "--input": "34 18% 84%",
              "--ring": "32 45% 50%",
              "--sidebar-background": "42 35% 98%",
              "--sidebar-foreground": "28 12% 20%",
              "--sidebar-primary": "32 45% 39%",
              "--sidebar-primary-foreground": "40 33% 98%",
              "--sidebar-accent": "38 24% 92%",
              "--sidebar-accent-foreground": "28 14% 24%",
              "--sidebar-border": "34 18% 84%",
              "--sidebar-ring": "32 45% 50%",
          } as CSSProperties
        }
      >
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
        </div>
        </AskRailProvider>
        </ActiveScheduleProvider>
        </ActiveSubjectProvider>
      </DiaryHeaderProvider>
    </AuthGuard>
  )
}
