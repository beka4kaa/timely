// Название чата сверху разговора. То же слово, что в списке чатов, пока имени нет.

export const NEW_CHAT_TITLE = "Новый чат";

export function chatTitle(title: string | null | undefined): string {
  return title?.trim() || NEW_CHAT_TITLE;
}
