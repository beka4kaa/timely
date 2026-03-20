import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { AuthGuard } from "@/components/auth-guard"
import { DiaryHeaderProvider } from "@/contexts/diary-header-ctx"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard requireAuth={true}>
      <SidebarProvider defaultOpen={true}>
        <div className="flex h-screen w-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="flex-1 min-w-0 overflow-hidden">
            <DiaryHeaderProvider>
              <SiteHeader />
              <main className="flex-1 overflow-auto">
                {children}
              </main>
            </DiaryHeaderProvider>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AuthGuard>
  )
}