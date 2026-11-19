// Чем делятся кнопкой «Поделиться» сверху: публичная ссылка на снимок разговора. Её
// создаёт и удаляет сам ученик; по ней видно только текст реплик (см. share-chat.tsx).

export interface ShareTurn {
  role: string;
  content: string;
  error?: string;
}

/** Есть ли чем делиться: хотя бы одна реплика без ошибки. */
export function canShareChat(turns: ShareTurn[]): boolean {
  return turns.some((turn) => !turn.error && turn.content.trim());
}

/** Публичная ссылка на чат: страница `/share/<токен>` на этом же сайте. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/share/${token}`;
}
