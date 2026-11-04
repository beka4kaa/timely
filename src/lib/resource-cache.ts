"use client";

// Маленький кэш запросов для главной и рейла.
//
// Рейл на каждой странице хочет знать, идёт ли сейчас занятие и обрабатывается
// ли книга, а главная грузит те же блоки и книги целиком. Без общего кэша это
// были бы одинаковые запросы дважды за один заход. Здесь у каждого ресурса
// есть ключ: два компонента с одним ключом делят один запрос и один ответ.
//
// Нарочно без библиотеки: нужны дедупликация, срок свежести и перезагрузка —
// три десятка строк, а не новая зависимость.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

export interface ResourceState<T> {
  data: T | undefined;
  error: string | null;
  /** Идёт первая загрузка: данных ещё нет. Фоновое обновление сюда не входит. */
  loading: boolean;
  /** Когда данные получены, epoch ms. 0 — ещё ни разу или они объявлены устаревшими. */
  loadedAt: number;
  /** Когда упала последняя попытка. 0 — после последней удачи падений не было. */
  failedAt: number;
  /** Сколько попыток подряд упало — от этого растёт пауза перед повтором. */
  failures: number;
  /** Сколько раз ресурс объявляли устаревшим (`invalidateResources`). */
  generation: number;
}

interface Entry {
  state: ResourceState<unknown>;
  promise: Promise<void> | null;
}

const EMPTY: ResourceState<never> = {
  data: undefined,
  error: null,
  loading: false,
  loadedAt: 0,
  failedAt: 0,
  failures: 0,
  generation: 0,
};

/** Первый повтор через 15 с, дальше вдвое дольше, но не реже срока свежести. */
const RETRY_BASE_MS = 15_000;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(key: string, patch: Partial<ResourceState<unknown>>) {
  const entry = entries.get(key) ?? { state: EMPTY, promise: null };
  // Новый объект на каждое изменение: по ссылке `useSyncExternalStore`
  // понимает, что пора перерисоваться.
  entries.set(key, { ...entry, state: { ...entry.state, ...patch } });
  emit();
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось загрузить";
}

/** Что сейчас известно о ресурсе. */
export function readResource<T>(key: string): ResourceState<T> {
  return (entries.get(key)?.state ?? EMPTY) as ResourceState<T>;
}

/** Загрузить, если данных нет или они старше `ttl`. Параллельные вызовы делят один запрос. */
export function loadResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  force = false,
): Promise<void> {
  const entry = entries.get(key);
  if (entry?.promise) return entry.promise;
  const fresh = entry && entry.state.loadedAt && Date.now() - entry.state.loadedAt < ttl;
  if (fresh && !force) return Promise.resolve();

  // Пока запрос шёл, ресурс могли объявить устаревшим. Тогда его ответ ничего
  // не решает — ни данными, ни ошибкой: всё уже решает запрос поновее.
  const generation = entry?.state.generation ?? 0;
  const outdated = () => readResource(key).generation !== generation;

  const promise = (async () => {
    // «Загружается» — только пока данных нет вовсе. Фоновое обновление
    // показывает старые данные, а не заглушку.
    if (entry?.state.data === undefined) setState(key, { loading: true });
    try {
      const data = await fetcher();
      if (outdated()) return;
      setState(key, {
        data,
        error: null,
        loading: false,
        loadedAt: Date.now(),
        failedAt: 0,
        failures: 0,
      });
    } catch (error) {
      if (outdated()) return;
      const failures = (entries.get(key)?.state.failures ?? 0) + 1;
      setState(key, {
        error: errorText(error),
        loading: false,
        failedAt: Date.now(),
        failures,
      });
    } finally {
      const current = entries.get(key);
      if (current && !outdated()) entries.set(key, { ...current, promise: null });
    }
  })();
  const current = entries.get(key) ?? { state: EMPTY, promise: null };
  entries.set(key, { ...current, promise });
  return promise;
}

/**
 * Пометить устаревшими все ресурсы с этим префиксом и перезагрузить те, что на экране.
 *
 * Запрос, который сейчас идёт, мог уйти раньше изменения, и его ответ выдал бы
 * старые данные за свежие. Поэтому о нём забываем: следующая загрузка начнёт
 * новый запрос, а не присоединится к этому. Паузы между повторами тоже считаются
 * заново: ученик только что что-то сделал и ждёт результат, а не следующей попытки
 * через две минуты.
 *
 * `patch` правит уже полученные данные сразу. Для того, что известно наверняка:
 * перезагрузка может и упасть, а такое знание не должно пропасть вместе с ней.
 */
export function invalidateResources<T>(prefix: string, patch?: (data: T) => T) {
  entries.forEach((entry, key) => {
    if (!key.startsWith(prefix)) return;
    const { state } = entry;
    entries.set(key, {
      promise: null,
      state: {
        ...state,
        data: patch && state.data !== undefined ? patch(state.data as T) : state.data,
        loadedAt: 0,
        failures: 0,
        generation: state.generation + 1,
      },
    });
  });
  emit();
}

/**
 * Ресурс по ключу. `null` вместо ключа — подождать (например, пока нет почты
 * пользователя для запроса).
 */
export function useResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { ttl = 60_000, delay = 0 }: { ttl?: number; delay?: number } = {},
): ResourceState<T> & { reload: () => void } {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const state = useSyncExternalStore(
    subscribe,
    () => (key ? readResource<T>(key) : EMPTY),
    () => EMPTY,
  ) as ResourceState<T>;

  // `generation` в зависимостях: `invalidateResources` меняет её, и ресурс,
  // который сейчас на экране, тут же перезагружается. Именно она, а не
  // `loadedAt`: у ресурса, который ещё грузится или упал, тот и так равен нулю,
  // и второе изменение подряд осталось бы незамеченным.
  const { generation } = state;
  useEffect(() => {
    if (!key) return;
    const run = () => void loadResource(key, () => fetcherRef.current(), ttl);
    if (!delay) {
      run();
      return;
    }
    const timer = window.setTimeout(run, delay);
    return () => window.clearTimeout(timer);
  }, [key, ttl, delay, generation]);

  // Пока ресурс на экране, он обновляется по сроку свежести. Без этого рейл,
  // который живёт в layout и не размонтируется, держал бы отметки с первого
  // захода до перезагрузки страницы. В скрытой вкладке не ходим: вернувшись,
  // её обновит `visibilitychange` ниже.
  //
  // Упавшая попытка — тоже повод вернуться: с паузой, которая растёт с каждым
  // падением подряд. Без этого один неудачный запрос (ноутбук проснулся
  // раньше Wi-Fi) останавливал обновление до перезагрузки страницы.
  const { loadedAt, failedAt, failures } = state;
  useEffect(() => {
    if (!key) return;
    let due: number;
    if (failedAt) {
      due = failedAt + Math.min(ttl, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
    } else if (loadedAt) {
      due = loadedAt + ttl;
    } else {
      return;
    }
    const timer = window.setTimeout(() => {
      if (!document.hidden) {
        void loadResource(key, () => fetcherRef.current(), ttl, Boolean(failedAt));
      }
    }, Math.max(1000, due - Date.now()));
    return () => window.clearTimeout(timer);
  }, [key, ttl, loadedAt, failedAt, failures]);

  useEffect(() => {
    if (!key) return;
    const onVisible = () => {
      if (!document.hidden) void loadResource(key, () => fetcherRef.current(), ttl);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [key, ttl]);

  const reload = useCallback(() => {
    if (key) void loadResource(key, () => fetcherRef.current(), ttl, true);
  }, [key, ttl]);

  return { ...state, reload };
}
