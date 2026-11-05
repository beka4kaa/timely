// Название сессии живёт в браузере: API помодоро такого поля не принимает.
//
// Два ключа: что написано в поле сейчас и какие имена были у завершённых сессий. На другом
// устройстве те же сессии останутся безымянными, это честная цена, пока имени нет на сервере.

import { sessionKey, withSessionName } from "./pomodoro.logic";

const NAME_KEY = "timely:pomodoro:name";
const NAMES_KEY = "timely:pomodoro:names";

export function readSessionName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeSessionName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Приватный режим: имя просто не переживёт перезагрузку.
  }
}

export function readSessionNames(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(NAMES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Запоминает, как называлась сессия, начатая в этот момент. */
export function rememberSessionName(startedAt: string, name: string): void {
  try {
    const before = readSessionNames();
    const after = withSessionName(before, startedAt, name);
    if (after !== before) window.localStorage.setItem(NAMES_KEY, JSON.stringify(after));
  } catch {
    // То же, что выше: без хранилища в истории будет просто «Фокус».
  }
}

export function sessionNameOf(names: Record<string, string>, startedAt: string): string {
  return names[sessionKey(startedAt)] ?? "";
}
