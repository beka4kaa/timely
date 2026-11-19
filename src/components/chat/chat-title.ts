// Название чата сверху разговора. То же слово, что в списке чатов, пока имени нет.

import { msg, t } from "../../lib/i18n";

export const NEW_CHAT_TITLE = msg("Новый чат");

export function chatTitle(title: string | null | undefined): string {
  return title?.trim() || t(NEW_CHAT_TITLE);
}
