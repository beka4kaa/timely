/**
 * curriculum-catalog.ts — сборка каталога предметов из трёх плоских списков.
 *
 * Каталог не имеет отдельного эндпоинта намеренно: цели, книги и планы уже
 * отдаются готовыми list-ручками, а сериализаторы списков компактные. Лишний
 * агрегирующий эндпоинт — это лишний контракт, который придётся держать в
 * согласии с тремя существующими.
 *
 * Сборка вынесена в чистую функцию, а не в компонент, по той же причине, что и
 * `curriculum-ribbon.ts`: соединение по ключам — это место, где легко потерять
 * строку, и его нужно проверять тестами без React и без сети.
 *
 * Главное правило: **ничего не теряется**. Книга без предмета и книга, чей
 * предмет исчез, обязаны остаться видимыми — иначе ученик решит, что загрузка
 * пропала, и загрузит файл ещё раз.
 */

import type {
  CoursePlanSummary,
  CurriculumDocument,
  LearningGoal,
} from "@/lib/curriculum-api";

/** Книга вместе с планами, построенными по ней. */
export interface CatalogBook {
  document: CurriculumDocument;
  plans: CoursePlanSummary[];
}

export interface CatalogSubject {
  goal: LearningGoal | null;
  /** `null` у группы «Без предмета» — она не открывается как карточка. */
  goalId: string | null;
  title: string;
  direction: string;
  books: CatalogBook[];
  /** Планы предмета, чья книга удалена: план живёт, `document` у него null. */
  orphanPlans: CoursePlanSummary[];
}

export const UNSORTED_TITLE = "Без предмета";

/**
 * Заголовок карточки.
 *
 * `normalized_subject` — это результат разбора цели моделью, и он пуст, пока
 * разбор не прошёл. Тогда показываем исходную формулировку ученика: своя
 * фраза понятнее, чем пустая карточка.
 */
export function subjectTitle(goal: LearningGoal): string {
  return (
    goal.normalized_subject?.trim() ||
    goal.original_text?.trim() ||
    "Новый предмет"
  );
}

export function buildCatalog(
  goals: readonly LearningGoal[],
  documents: readonly CurriculumDocument[],
  plans: readonly CoursePlanSummary[],
): CatalogSubject[] {
  const plansByDocument = new Map<string, CoursePlanSummary[]>();
  const plansWithoutDocument: CoursePlanSummary[] = [];
  for (const plan of plans) {
    if (!plan.document) {
      plansWithoutDocument.push(plan);
      continue;
    }
    const bucket = plansByDocument.get(plan.document);
    if (bucket) bucket.push(plan);
    else plansByDocument.set(plan.document, [plan]);
  }

  const knownGoalIds = new Set(goals.map((goal) => goal.id));
  const booksByGoal = new Map<string, CatalogBook[]>();
  const booksWithoutSubject: CatalogBook[] = [];

  for (const document of documents) {
    const book: CatalogBook = {
      document,
      plans: plansByDocument.get(document.id) || [],
    };
    // Книга, чей предмет удалён, не должна исчезать вместе с ним: на сервере
    // такого не бывает (CASCADE), но ответы трёх запросов приходят
    // порознь и вполне могут разъехаться во времени.
    const goalId = document.goal;
    if (!goalId || !knownGoalIds.has(goalId)) {
      booksWithoutSubject.push(book);
      continue;
    }
    const bucket = booksByGoal.get(goalId);
    if (bucket) bucket.push(book);
    else booksByGoal.set(goalId, [book]);
  }

  const orphanPlansByGoal = new Map<string, CoursePlanSummary[]>();
  for (const plan of plansWithoutDocument) {
    const bucket = orphanPlansByGoal.get(plan.goal);
    if (bucket) bucket.push(plan);
    else orphanPlansByGoal.set(plan.goal, [plan]);
  }

  const subjects: CatalogSubject[] = goals.map((goal) => ({
    goal,
    goalId: goal.id,
    title: subjectTitle(goal),
    direction: goal.normalized_direction?.trim() || "",
    books: booksByGoal.get(goal.id) || [],
    orphanPlans: orphanPlansByGoal.get(goal.id) || [],
  }));

  if (booksWithoutSubject.length > 0) {
    subjects.push({
      goal: null,
      goalId: null,
      title: UNSORTED_TITLE,
      direction: "",
      books: booksWithoutSubject,
      orphanPlans: [],
    });
  }

  return subjects;
}

/**
 * Что показать в строке предмета одним словом.
 *
 * Порядок проверок — это порядок срочности для ученика: сначала то, что
 * требует действия, потом то, что идёт само, и лишь потом «всё хорошо».
 */
export type SubjectState =
  | "empty"
  | "failed"
  | "processing"
  | "ready_to_plan"
  | "has_plan";

export function subjectState(subject: CatalogSubject): SubjectState {
  if (subject.books.length === 0 && subject.orphanPlans.length === 0) {
    return "empty";
  }
  if (subject.books.some((book) => book.plans.length > 0)) return "has_plan";
  if (subject.orphanPlans.length > 0) return "has_plan";
  if (
    subject.books.some((book) => book.document.ingestion_status === "failed")
  ) {
    return "failed";
  }
  if (subject.books.some((book) => book.document.ingestion_status === "ready")) {
    return "ready_to_plan";
  }
  return "processing";
}
