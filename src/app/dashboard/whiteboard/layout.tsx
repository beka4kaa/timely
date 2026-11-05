import { redirect } from "next/navigation";

import { BOARD_ENABLED } from "@/config/features";

// Доска выключена в продакшене: старые ссылки и закладки ведут в чат.
export default function WhiteboardLayout({ children }: { children: React.ReactNode }) {
  if (!BOARD_ENABLED) redirect("/dashboard/chat");
  return children;
}
