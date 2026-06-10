import { AuthGuard } from "@/components/auth-guard";

export default function BoardPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard requireAuth={true}>
      {/* Full-screen layout without dashboard sidebar/header */}
      <div className="h-screen w-screen overflow-hidden">{children}</div>
    </AuthGuard>
  );
}
