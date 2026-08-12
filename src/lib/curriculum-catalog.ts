/**
 * curriculum-catalog.ts — сборка каталога предметов из четырёх плоских списков.
 *
 * Каталог не имеет отдельного эндпоинта намеренно: цели, книги, материалы и
 * планы уже отдаются готовыми list-ручками, а сериализаторы списков компактные.
 * Лишний агрегирующий эндпоинт — это лишний контракт, который придётся держать
 * в согласии с четырьмя существующими.
 *
 * Сборка вынесена в чистую функцию, а не в компонент, по той же причине, что и
 * `curriculum-ribbon.ts`: соединение по ключам — это место, где легко потерять
 * строку, и его нужно проверять тестами без React и без сети.
 *
 * У предмета два вида источников, и в интерфейсе они стоят одним списком.
 * Книга даёт программу через планировщик и RAG, материал — детерминированным
 * расчётом; для ученика это просто «то, по чему я занимаюсь». Поэтому наружу
 * идёт объединение `CatalogSource`, а не два параллельных массива.
 *
 * Главное правило: **ничего не теряется**. Источник без предмета и источник,
 * чей предмет исчез, обязаны остаться видимыми — иначе ученик решит, что
 * загрузка пропала, и загрузит файл ещё раз.
 */

import type {
  CoursePlanSummary,
  CurriculumDocument,
  LearningGoal,
  StudyMaterial,
} from "@/lib/curriculum-api";

/** Книга вместе с планами, построенными по ней. */
export interface CatalogBook {
  kind: "book";
  document: CurriculumDocument;
  plans: CoursePlanSummary[];
}

/** Источник без файла вместе с планами, посчитанными по нему. */
export interface CatalogMaterial {
  kind: "material";
  material: StudyMaterial;
  plans: CoursePlanSummary[];
}

export type CatalogSource = CatalogBook | CatalogMaterial;

export interface CatalogSubject {
  goal: LearningGoal | null;
  /** `null` у группы «Без предмета» — она не открывается как карточка. */
  goalId: string | null;
  title: string;
  direction: string;
  /** Книги и материалы вперемешку, в порядке «сначала книги». */
  sources: CatalogSource[];
  /** Планы предмета, чей источник удалён: план живёт, ссылка у него null. */
  orphanPlans: CoursePlanSummary[];
}

export const UNSORTED_TITLE = "Без предмета";

/** Только книги — там, где важен именно учебник (счётчики, обработка). */
export function booksOf(subject: CatalogSubject): CatalogBook[] {
  return subject.sources.filter(
    (source): source is CatalogBook => source.kind === "book",
  );
}

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
  materials: readonly StudyMaterial[] = [],
): CatalogSubject[] {
  const plansByDocument = new Map<string, CoursePlanSummary[]>();
  const plansByMaterial = new Map<string, CoursePlanSummary[]>();
  const plansWithoutSource: CoursePlanSummary[] = [];

  for (const plan of plans) {
    if (plan.document) {
      push(plansByDocument, plan.document, plan);
    } else if (plan.material) {
      push(plansByMaterial, plan.material, plan);
    } else {
      plansWithoutSource.push(plan);
    }
  }

  const knownGoalIds = new Set(goals.map((goal) => goal.id));
  const sourcesByGoal = new Map<string, CatalogSource[]>();
  const sourcesWithoutSubject: CatalogSource[] = [];

  // Книги идут первыми, чтобы порядок внутри предмета не прыгал при каждом
  // добавлении материала: список источников — это не лента событий.
  for (const document of documents) {
    place(
      { kind: "book", document, plans: plansByDocument.get(document.id) || [] },
      document.goal,
    );
  }
  for (const material of materials) {
    place(
      { kind: "material", material, plans: plansByMaterial.get(material.id) || [] },
      material.goal,
    );
  }

  function place(source: CatalogSource, goalId: string | null) {
    // Источник, чей предмет удалён, не должен исчезать вместе с ним: на
    // сервере такого не бывает (CASCADE), но ответы четырёх запросов приходят
    // порознь и вполне могут разъехаться во времени.
    if (!goalId || !knownGoalIds.has(goalId)) {
      sourcesWithoutSubject.push(source);
      return;
    }
    push(sourcesByGoal, goalId, source);
  }

  const orphanPlansByGoal = new Map<string, CoursePlanSummary[]>();
  for (const plan of plansWithoutSource) {
    push(orphanPlansByGoal, plan.goal, plan);
  }

  const subjects: CatalogSubject[] = goals.map((goal) => ({
    goal,
    goalId: goal.id,
    title: subjectTitle(goal),
    direction: goal.normalized_direction?.trim() || "",
    sources: sourcesByGoal.get(goal.id) || [],
    orphanPlans: orphanPlansByGoal.get(goal.id) || [],
  }));

  if (sourcesWithoutSubject.length > 0) {
    subjects.push({
      goal: null,
      goalId: null,
      title: UNSORTED_TITLE,
      direction: "",
      sources: sourcesWithoutSubject,
      orphanPlans: [],
    });
  }

  return subjects;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
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
  if (subject.sources.length === 0 && subject.orphanPlans.length === 0) {
    return "empty";
  }
  if (subject.sources.some((source) => source.plans.length > 0)) {
    return "has_plan";
  }
  if (subject.orphanPlans.length > 0) return "has_plan";

  const books = booksOf(subject);
  if (books.some((book) => book.document.ingestion_status === "failed")) {
    return "failed";
  }
  // Материал готов к расчёту сразу: обрабатывать в нём нечего, поэтому
  // предмет с одними материалами никогда не «обрабатывается».
  if (
    books.some((book) => book.document.ingestion_status === "ready") ||
    subject.sources.some((source) => source.kind === "material")
  ) {
    return "ready_to_plan";
  }
  return "processing";
}
