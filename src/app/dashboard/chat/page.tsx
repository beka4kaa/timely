"use client";

// Раздел «Тьютор».
//
// Обёртка нарочно пустая: `CoffeePageShell` даёт `max-w-[1240px]` и собственный
// скролл, а разговору нужен липкий низ и три колонки во всю высоту. Имя раздела
// печатает `SiteHeader` из `dashboardPageMeta`.

import { ChatPage } from "@/components/chat/chat-page";

export default function TutorChatPage() {
  return <ChatPage />;
}
