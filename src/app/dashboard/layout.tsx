import type { Metadata } from "next"
import type { CSSProperties } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { AuthGuard } from "@/components/auth-guard"
import { DiaryHeaderProvider } from "@/contexts/diary-header-ctx"

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
          <SiteHeader />
          <AppSidebar />
          <main className="timely-dashboard-surface fixed bottom-0 left-0 right-0 top-12 z-0 overflow-auto md:left-[58px]">
            {children}
          </main>
        </div>
      </DiaryHeaderProvider>
    </AuthGuard>
  )
}
