import type { Metadata } from "next";

import { SharedChatView } from "@/components/chat/shared-chat-view";
import { marketingOriginFromEnv } from "@/lib/host-routing";

// Ссылку ученик отправляет сам; в поиск она попадать не должна.
export const metadata: Metadata = {
  title: "Разговор с тьютором",
  robots: { index: false, follow: false },
};

export default async function SharedChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedChatView token={token} home={marketingOriginFromEnv()} />;
}
