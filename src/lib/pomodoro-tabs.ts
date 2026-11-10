// Как таймер живёт во вкладках браузера.
//
// Тик идёт из Web Worker: Chrome душит таймеры свёрнутой вкладки, и через пять минут
// цепочки `setInterval` на странице срабатывают раз в минуту, а таймеры воркера нет.
// Воркер собирается из строки через blob-адрес. CSP у приложения нет; если её добавят,
// ей понадобится `worker-src blob:`, а пока воркер не создастся, тик сам перейдёт на
// обычный интервал.
//
// Ведёт таймер одна вкладка: она заканчивает фазы, отправляет сессии и показывает
// уведомления, иначе две вкладки записали бы одну сессию дважды. Остальные получают
// состояние через localStorage. Видимая вкладка забирает ведение себе: фоновую браузер
// может заморозить совсем.

const TICK_SOURCE =
  "let id=0;onmessage=function(e){clearInterval(id);if(e.data>0)id=setInterval(function(){postMessage(0)},e.data)}";

/** Зовёт `onTick` раз в секунду, даже на свёрнутой вкладке. Возвращает функцию остановки. */
export function startTicker(onTick: () => void, everyMs = 1000): () => void {
  let stopInterval: (() => void) | null = null;
  const fallback = () => {
    if (stopInterval) return;
    const id = window.setInterval(onTick, everyMs);
    stopInterval = () => window.clearInterval(id);
  };

  let worker: Worker | null = null;
  let url = "";
  try {
    url = URL.createObjectURL(new Blob([TICK_SOURCE], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = () => onTick();
    // Воркер не загрузился (например, запретила политика безопасности): тикаем по-старому.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      fallback();
    };
    worker.postMessage(everyMs);
  } catch {
    worker = null;
    fallback();
  }

  return () => {
    worker?.terminate();
    if (url) URL.revokeObjectURL(url);
    stopInterval?.();
  };
}

const LOCK_NAME = "timely:pomodoro";

/**
 * Выбирает ведущую вкладку через Web Locks. Без них (старый браузер) ведут все, как
 * раньше. Возвращает функцию, которая отпускает ведение.
 */
export function leadTimer(onChange: (leader: boolean) => void): () => void {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) {
    onChange(true);
    return () => undefined;
  }

  let disposed = false;
  let release: (() => void) | null = null;
  let queued: AbortController | null = null;

  const request = (steal: boolean) => {
    if (disposed) return;
    const controller = steal ? null : new AbortController();
    queued = controller;
    const options: LockOptions = controller ? { signal: controller.signal } : { steal: true };
    locks
      .request(LOCK_NAME, options, () => {
        if (disposed) return undefined;
        if (queued === controller) queued = null;
        onChange(true);
        // Держим, пока вкладка жива или ведение не забрала другая.
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch((error: unknown) => {
        // Сами отменили очередь, чтобы забрать ведение, или компонент уже снят: его
        // место заняла новая копия, и чужое «не веду» ей только помешало бы.
        if (disposed || controller?.signal.aborted) return;
        const held = release;
        release = null;
        held?.();
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Замки отказали совсем: ведём сами, как без них, и не крутимся в повторах.
          onChange(true);
          return;
        }
        // Ведение забрала другая вкладка: встаём в очередь на случай, если она закроется.
        onChange(false);
        request(false);
      });
  };

  const claim = () => {
    if (disposed || release) return;
    queued?.abort();
    queued = null;
    request(true);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") claim();
  };

  if (document.visibilityState === "visible") request(true);
  else request(false);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    queued?.abort();
    release?.();
    release = null;
    onChange(false);
  };
}
