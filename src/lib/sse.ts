// Чтение Server-Sent Events из fetch-ответа.
//
// Такой же цикл написан внутри board/ai-chat.tsx. Оттуда он не выносится
// намеренно: доска работает, и трогать её ради переиспользования — менять
// работающее без нужды. Новый код пользуется этим, общим.

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Разбирает поток в события по мере поступления.
 *
 * Кадр SSE заканчивается пустой строкой, но приходит он как попало: провайдер
 * режет данные по своим границам, и `data:` вполне может приехать двумя
 * кусками. Поэтому недочитанный хвост остаётся в буфере до следующего чтения.
 */
export async function* readSse(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // Ученик закрыл панель или ушёл со страницы — соединение надо отпустить,
    // иначе бэкенд продолжит генерировать ответ, который некому читать.
    reader.releaseLock();
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;

  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    // Битый кадр — не повод рвать весь поток: следующий может быть целым.
    return null;
  }
}
