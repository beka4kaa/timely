// Голосовой ввод в поле чата: браузерное распознавание речи (Web Speech API).
//
// Здесь только то, что не зависит от браузера: как собрать услышанное и как дописать его
// к набранному. Само распознавание — в use-dictation.ts. Работает в Chrome, Edge и Safari;
// где его нет (Firefox), кнопки микрофона просто нет.

export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

/** Текст из всех кусков распознавания; готов, когда окончательные все куски. */
export function heardFrom(
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>,
): { text: string; final: boolean } {
  const list = Array.from(results);
  const text = list
    .map((result) => result[0]?.transcript.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return { text, final: list.length > 0 && list.every((result) => result.isFinal) };
}

/** Набранное плюс сказанное, через один пробел. */
export function withHeard(base: string, heard: string): string {
  if (!heard) return base;
  const start = base.trimEnd();
  return start ? `${start} ${heard}` : heard;
}
