"use client";

// Что ученик настроил в чате: модель, уровень рассуждения и что показывать.
//
// Живёт в этом браузере, как и остальные настройки: строка пользователя в базе есть не у
// всех. Ключ пустой значит «как решит сервер», поэтому новый посетитель ничего не выбирает.

import { useSyncExternalStore } from "react";

export interface ChatPrefs {
  model: string;
  reasoning: string;
  /** Выбор модели в поле чата. */
  showPicker: boolean;
  /** Контекстное окно в поле чата и токены под ответами. */
  showUsage: boolean;
}

const DEFAULTS: ChatPrefs = { model: "", reasoning: "", showPicker: true, showUsage: false };
const KEY = "timely.chat.prefs";

let cache: ChatPrefs | null = null;
const listeners = new Set<() => void>();

function load(): ChatPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ChatPrefs>) } : DEFAULTS;
  } catch {
    // Закрытое хранилище или испорченная запись: работаем с умолчаниями.
    return DEFAULTS;
  }
}

/** Текущие настройки для кода вне React: движок читает их в момент вопроса. */
export function chatPrefs(): ChatPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  cache ??= load();
  return cache;
}

export function setChatPrefs(patch: Partial<ChatPrefs>): void {
  cache = { ...chatPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Настройка проживёт до перезагрузки.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Настройки поменяли в другой вкладке.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = load();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useChatPrefs(): ChatPrefs {
  return useSyncExternalStore(subscribe, chatPrefs, () => DEFAULTS);
}
