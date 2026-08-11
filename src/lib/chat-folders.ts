// Разговоры по папкам: папка — это предмет.
//
// Раньше список слева шёл сплошной лентой по дням. Для одного предмета это
// работало, для пяти — нет: «вчера» ничего не говорит о том, физика это была
// или алгебра, и разговоры разных предметов перемешивались в одну кашу.
//
// Предмет — естественная папка: у него своя книга, свои цитаты и свой контекст
// ответа. Пустые папки остаются в списке: это способ начать разговор по
// предмету, а не мусор.
//
// Отдельным модулем, потому что порядок и границы здесь важнее разметки:
// предметы идут в порядке каталога, «Без книги» всегда последняя, внутри папки
// свежие сверху.

export interface FolderSubject {
  goalId: string;
  title: string;
  /** Сколько обработанных книг. Ноль — отвечать будет модель, без цитат. */
  books: number;
}

export interface ChatFolder<T> {
  /** `null` — папка разговоров без книги. */
  goalId: string | null;
  title: string;
  books: number;
  chats: T[];
}

interface FoldableChat {
  goal: string | null;
  updated_at: string;
}

/** Заголовок папки для разговоров, у которых предмета нет. */
export const NO_BOOK_FOLDER = "Без книги";

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

  const folders: ChatFolder<T>[] = subjects.map((subject) => ({
    goalId: subject.goalId,
    title: subject.title,
    books: subject.books,
    chats: recentFirst(byGoal.get(subject.goalId) ?? []),
  }));

  // «Без книги» появляется, только когда в ней что-то есть: пустая папка
  // сообщала бы об отсутствии разговоров, а не о возможности их завести —
  // завести их можно из выбора книги в поле ввода.
  if (loose.length) {
    folders.push({
      goalId: null,
      title: NO_BOOK_FOLDER,
      books: 0,
      chats: recentFirst(loose),
    });
  }

  return folders;
}

function recentFirst<T extends FoldableChat>(chats: T[]): T[] {
  // Порядок сервера не гарантирован, а перескок дат внутри папки выглядит
  // как сбой.
  return [...chats].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
}
