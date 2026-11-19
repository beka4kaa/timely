import type { Metadata } from "next";

import { SharedChatView } from "@/components/chat/shared-chat-view";
import { marketingOriginFromEnv } from "@/lib/host-routing";
import { serverT } from "@/lib/i18n/server";

// Ссылку ученик отправляет сам; в поиск она попадать не должна.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("Разговор с тьютором"), robots: { index: false, follow: false } };
}

export default async function SharedChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedChatView token={token} home={marketingOriginFromEnv()} />;
}
