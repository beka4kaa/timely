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

/** Название раздела в меню, заголовке и ссылках «назад». */
export const SECTION_LABEL = curriculumSectionLabel(BOOKS_ENABLED);
export const TAB_LABEL = curriculumTabLabel(BOOKS_ENABLED);
