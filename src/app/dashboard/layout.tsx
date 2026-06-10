import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { AuthGuard } from "@/components/auth-guard"
import { DiaryHeaderProvider } from "@/contexts/diary-header-ctx"
import { SidebarProvider } from "@/components/ui/sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard requireAuth={true}>
      <SidebarProvider defaultOpen={false}>
        {/* Контейнер всего дашборда */}
        <div className="relative h-screen w-full overflow-hidden bg-background">
          
          {/* Сайдбар вырван из flex/grid и помещен в absolute (z-index: 50). 
              Теперь он висит поверх всего контента и не сдвигает его. */}
          <div className="absolute inset-y-0 left-0 z-50 h-full">
            <AppSidebar />
          </div>

          {/* Контент занимает всю ширину окна (100vw) всегда */}
          <main className="absolute inset-0 z-0 flex flex-col h-full w-full overflow-hidden">
            <DiaryHeaderProvider>
              <SiteHeader />
              <div className="flex-1 overflow-auto w-full h-full relative">
                {children}
              </div>
            </DiaryHeaderProvider>
          </main>

        </div>
      </SidebarProvider>
    </AuthGuard>
  )
}