// Системные уведомления помодоро: «Пора на перерыв: 10 минут».
//
// Разрешение спрашивается только по клику ученика. Без разрешения таймер работает как
// обычно, просто без уведомлений. Все уведомления таймера под одним тегом, поэтому
// новое заменяет старое, а не копится в центре уведомлений.

const TAG = "timely-pomodoro";

export type NoticePermission = NotificationPermission | "unsupported";

export interface NoticeHandle {
  close: () => void;
}

export function noticePermission(): NoticePermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Спросить разрешение. Звать из обработчика клика: иначе браузер промолчит. */
export async function askNoticePermission(): Promise<NoticePermission> {
  const current = noticePermission();
  if (current !== "default") return current;
  try {
    return await Notification.requestPermission();
  } catch {
    return noticePermission();
  }
}

/**
 * Показывает уведомление. Клик по нему открывает вкладку и зовёт `onClick`.
 *
 * На Android Chrome конструктор `Notification` бросает исключение: там уведомления
 * показывает только service worker. Если он есть, идём через него, если нет, обходимся
 * без уведомления: звонок и заголовок всё равно сработают.
 */
export async function showNotice(
  notice: { title: string; body: string },
  onClick: () => void,
): Promise<NoticeHandle | null> {
  if (noticePermission() !== "granted") return null;
  // `renotify` есть не во всех браузерах и не в типах: с ним замена под тем же тегом
  // снова показывается, а не меняется молча. Иконки нет: SVG браузеры в уведомлении не рисуют.
  const options = { body: notice.body, tag: TAG, renotify: true } as NotificationOptions;
  try {
    const note = new Notification(notice.title, options);
    note.onclick = () => {
      window.focus();
      onClick();
      note.close();
    };
    return note;
  } catch {
    // Ниже: путь через service worker.
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration) return null;
    await registration.showNotification(notice.title, options);
    return {
      close: () => {
        void registration
          .getNotifications({ tag: TAG })
          .then((notes) => notes.forEach((note) => note.close()))
          .catch(() => undefined);
      },
    };
  } catch {
    return null;
  }
}
