// Что в разделе «Курсы» зависит от флага книг. Функции чистые и принимают флаг
// параметром, чтобы их можно было проверить в обе стороны; готовые значения для
// сборки лежат внизу.

import { BOOKS_ENABLED } from "../config/features.ts";

/** Шаги мастера. Тип живёт здесь, чтобы не тянуть стор в тесты. */
export type WizardStep =
  | "goal"
  | "goal_confirm"
  | "upload"
  | "processing"
  | "planning"
  | "plan_review"
  | "done"
  | "shelf";

export interface RailStage {
  key: string;
  label: string;
  steps: WizardStep[];
}

/** Куда идти после подтверждения предмета: без книг мастер закрывается на полку. */
export function stepAfterGoal(booksEnabled: boolean): "upload" | "shelf" {
  return booksEnabled ? "upload" : "shelf";
}

/** Крупные вехи для полоски вверху мастера. Без книг стадии «Учебник» нет. */
export function wizardRail(booksEnabled: boolean): RailStage[] {
  const goal: RailStage = { key: "goal", label: "Цель", steps: ["goal", "goal_confirm"] };
  const book: RailStage = { key: "book", label: "Учебник", steps: ["upload", "processing"] };
  const plan: RailStage = {
    key: "plan",
    label: "Программа",
    steps: ["planning", "plan_review", "done"],
  };
  return booksEnabled ? [goal, book, plan] : [goal, plan];
}

export function curriculumSectionLabel(booksEnabled: boolean): string {
  return booksEnabled ? "Курсы и книги" : "Курсы";
}

export function curriculumTabLabel(booksEnabled: boolean): string {
  return booksEnabled ? "Книги" : "Курсы";
}

/** Выбор книги в поле ввода чата и в мини-окне: без книг выбирать не из чего. */
export function showBookPicker(booksEnabled: boolean): boolean {
  return booksEnabled;
}

/** Подсказка в поле чата: «по книге» только когда у предмета есть книга и книги включены. */
export function chatPlaceholder(booksEnabled: boolean, hasBook: boolean, fallback: string): string {
  return booksEnabled && hasBook ? "Спроси по книге" : fallback;
}

/** То же для мини-окна тьютора. */
export function railPlaceholder(booksEnabled: boolean, hasBook: boolean): string {
  return chatPlaceholder(booksEnabled, hasBook, "Чем помочь?");
}

/** Строка пустого чата. Без книг не обещаем ни книгу, ни страницу. */
export function chatEmptyLine(
  booksEnabled: boolean,
  subject: { title: string; books: number } | null,
): string {
  if (!booksEnabled) return "Учёба, план, как собраться с мыслями.";
  if (!subject) return "Учёба, план, как собраться с мыслями. Можно и по книге.";
  return subject.books
    ? `Отвечу по книге предмета «${subject.title}» и покажу страницу.`
    : `У предмета «${subject.title}» пока нет книги, отвечу своими словами.`;
}

/** Подсказка над счётчиком контекста. */
export function chatContextHint(booksEnabled: boolean): string {
  return booksEnabled
    ? "правила тьютора, последние реплики и фрагменты книги"
    : "правила тьютора и последние реплики";
}

/** Название раздела в меню, заголовке и ссылках «назад». */
export const SECTION_LABEL = curriculumSectionLabel(BOOKS_ENABLED);
export const TAB_LABEL = curriculumTabLabel(BOOKS_ENABLED);
