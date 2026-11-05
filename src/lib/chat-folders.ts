// Разговоры по группам в левой панели: сначала «Общие», дальше по предметам.
//
// Лента по дням для одного предмета работала, для пяти нет: «вчера» ничего не
// говорит о том, физика это была или алгебра. Предмет это естественная группа: у
// него своя книга, свои цитаты и свой контекст ответа.
//
// Группа без разговоров в списке не показывается: подпись, под которой ничего нет,
// это шум. Начать разговор по предмету можно из выбора книги в поле ввода.
//
// Отдельным модулем, потому что порядок и границы здесь важнее разметки: внутри
// группы свежие сверху, предметы идут в порядке каталога.

export interface FolderSubject {
  goalId: string;
  title: string;
  /** Сколько обработанных книг. Ноль — отвечать будет модель, без цитат. */
  books: number;
}

export interface ChatFolder<T> {
  /** `null` — разговоры без книги. */
  goalId: string | null;
  title: string;
  books: number;
  chats: T[];
}

interface FoldableChat {
  goal: string | null;
  updated_at: string;
}

/** Подпись группы для разговоров, у которых предмета нет. */
export const NO_BOOK_FOLDER = "Общие";

export function buildChatFolders<T extends FoldableChat>(
  chats: T[],
  subjects: FolderSubject[],
): ChatFolder<T>[] {
  const byGoal = new Map<string, T[]>();
  const loose: T[] = [];

  for (const chat of chats) {
    const known =
      chat.goal && subjects.some((subject) => subject.goalId === chat.goal);
    if (!known) {
      // Предмета нет вовсе — или он удалён, пока список ехал. Разговор всё
      // равно должен быть виден: терять переписку молча нельзя.
      loose.push(chat);
      continue;
    }
    const list = byGoal.get(chat.goal as string);
    if (list) list.push(chat);
    else byGoal.set(chat.goal as string, [chat]);
  }

  const folders: ChatFolder<T>[] = [];
  if (loose.length) {
    folders.push({
      goalId: null,
      title: NO_BOOK_FOLDER,
      books: 0,
      chats: recentFirst(loose),
    });
  }
  for (const subject of subjects) {
    const list = byGoal.get(subject.goalId);
    if (!list) continue;
    folders.push({
      goalId: subject.goalId,
      title: subject.title,
      books: subject.books,
      chats: recentFirst(list),
    });
  }
  return folders;
}

function recentFirst<T extends FoldableChat>(chats: T[]): T[] {
  // Порядок сервера не гарантирован, а перескок дат внутри группы выглядит
  // как сбой.
  return [...chats].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
}
