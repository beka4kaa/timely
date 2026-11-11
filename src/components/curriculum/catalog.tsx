// «Курсы и книги»: стеллаж предметов, с него начинается раздел.
//
// Карточка отвечает на вопрос «что у меня есть»: сверху курс с настоящим прогрессом,
// снизу полка с обложками. Под книгой подпись: сколько в ней страниц, на каком шаге
// обработка или что пошло не так.
//
// ИСТОЧНИК НЕ ТОЛЬКО КНИГА. К SAT готовятся по набору practice-тестов, к механике по
// задачнику. Для ученика это одна полка: «то, по чему я занимаюсь». Книга и материал
// приходят разными запросами, а `buildCatalog` соединяет их в единый `CatalogSource`.
//
// Данные собираются существующими list-запросами. Отдельного эндпоинта у каталога нет
// намеренно: он был бы ещё одним контрактом, который надо держать в согласии с ними.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BOOKS_ENABLED } from "@/config/features";
import { limitMessage } from "@/lib/ai-limit";
import { SECTION_LABEL } from "@/lib/curriculum-books";
import {
  CurriculumApiError,
  type CoursePlanSummary,
  type CurriculumDocument,
  type IngestionState,
  type LearningGoal,
  type StudyMaterial,
  deleteDocument,
  deleteGoal,
  deleteMaterial,
  deletePlan,
  generateMaterialPlan,
  getIngestionState,
  listDocuments,
  listGoals,
  listMaterials,
  listPlans,
  startIngestion,
} from "@/lib/curriculum-api";
import { type CatalogSource, type CatalogSubject, booksOf, buildCatalog } from "@/lib/curriculum-catalog";
import { coverAuthor, coverClass, coverTitle } from "@/lib/curriculum-cover";
import {
  type CourseProgress,
  courseFinishLine,
  percentOf,
} from "@/lib/curriculum-course-progress";
import { dayMonth } from "@/lib/curriculum-forecast";
import {
  canRecognizeLater,
  ingestionErrorMessage,
  ocrNotice,
  planProfilingNotice,
} from "@/lib/curriculum-progress";
import { cleanDocumentTitle } from "@/lib/curriculum-title";
import { useDataChanged } from "@/lib/data-changed";

import { AddSourceForm } from "./add-source";
import { kindLabel } from "./add-source.logic";
import { ConfirmingAction, OverflowMenu } from "./catalog-menu";
import { paperPopover } from "./paper";
import { useCatalogProgress } from "./use-course-progress";
import { useElementWidth } from "./use-element-width";

interface CatalogProps {
  onAddSubject: () => void;
  onAddBook: (goalId: string) => void;
  onContinueSetup: (goal: LearningGoal) => void;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
}

/** Состояние обработки книг, которые ещё не готовы: шаг, причина отказа, зависание. */
type IngestionMap = Record<string, IngestionState | null>;

/** Книга с промежутком до соседней, в пикселях. */
const BOOK_SLOT_PX = 102;
/** Поля карточки и полки: то, что остаётся под книгами. */
const SHELF_INSET_PX = 42;
/** В самую узкую карточку стеллажа помещаются две книги. */
const MIN_BOOKS_PER_SHELF = 2;

const WAIT_MESSAGE = "Не получилось загрузить книги. Проверь интернет и попробуй ещё раз.";

function effectiveStatus(document: CurriculumDocument, ingestion: IngestionMap): string {
  return ingestion[document.id]?.ingestion_status ?? document.ingestion_status;
}

function isSourceBusy(status: string): boolean {
  return status !== "ready" && status !== "failed";
}

export function CurriculumCatalog({
  onAddSubject,
  onAddBook,
  onContinueSetup,
  onShowProgress,
}: CatalogProps) {
  const [subjects, setSubjects] = useState<CatalogSubject[] | null>(null);
  const [ingestion, setIngestion] = useState<IngestionMap>({});
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [goals, documents, plans, materials] = await Promise.all([
        listGoals(),
        listDocuments(),
        listPlans(),
        listMaterials(),
      ]);
      // Шаг обработки и причина отказа живут только в статусе книги. Он же знает про
      // зависшую обработку: в списке такая книга выглядела бы идущей вечно.
      const unfinished = documents.filter((document) => document.ingestion_status !== "ready");
      const states = await Promise.all(
        unfinished.map(
          async (document) =>
            [document.id, await getIngestionState(document.id).catch(() => null)] as const,
        ),
      );
      setSubjects(buildCatalog(goals, documents, plans, materials));
      setIngestion(Object.fromEntries(states));
      setFailed(false);
    } catch {
      // Предыдущие данные не выбрасываем: опрос мог споткнуться на секунду.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged("subjects", () => void load());

  // Пока хоть одна книга обрабатывается, каталог обновляется сам: обработка идёт минутами,
  // и заставлять человека обновлять страницу, чтобы узнать исход, незачем.
  const waiting = (subjects ?? []).some((subject) =>
    booksOf(subject).some((book) => isSourceBusy(effectiveStatus(book.document, ingestion))),
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const shownPlans = useMemo(
    () =>
      (subjects ?? []).flatMap((subject) => [
        ...subject.sources.flatMap((source) => source.plans),
        ...subject.orphanPlans,
      ]),
    [subjects],
  );
  const progress = useCatalogProgress(shownPlans);

  const head = (
    <header className="head">
      <h1 className="title">{SECTION_LABEL}</h1>
      <div className="head-tools">
        <button type="button" className="btn btn-text" onClick={onAddSubject}>
          Добавить предмет
        </button>
        {BOOKS_ENABLED ? (
          <AddBookButton
            subjects={subjects ?? []}
            onAddBook={onAddBook}
            onAddSubject={onAddSubject}
          />
        ) : null}
      </div>
    </header>
  );

  if (subjects === null) {
    return (
      <div className="content view cur-page">
        {head}
        {failed ? (
          <LoadFailed onRetry={load} />
        ) : (
          <div className="case" aria-busy="true" aria-label="Загружаю книги">
            {[0, 1, 2].map((index) => (
              <div key={index} className="cab card cab-skel" aria-hidden="true">
                <span className="cur-skel skel-t" />
                <span className="cur-skel skel-l" />
                <span className="cur-skel skel-b" />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="content view cur-page">
      {head}

      {failed ? <p className="cur-alert">{WAIT_MESSAGE}</p> : null}

      {subjects.length === 0 ? (
        <EmptyLibrary onStart={onAddSubject} />
      ) : (
        <div className="case">
          {subjects.map((subject) => (
            <SubjectCard
              key={subject.goalId ?? "unsorted"}
              subject={subject}
              ingestion={ingestion}
              progress={progress.byPlan}
              progressLoaded={progress.loaded}
              onAddBook={onAddBook}
              onContinueSetup={onContinueSetup}
              onShowProgress={onShowProgress}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div className="card lib-empty">
      <div>
        <h2>Книги не загрузились</h2>
        <p>{WAIT_MESSAGE}</p>
        <button type="button" className="btn btn-main" onClick={() => void onRetry()}>
          Повторить
        </button>
      </div>
    </div>
  );
}

/** Новый ученик: пустая полка и один понятный шаг. */
function EmptyLibrary({ onStart }: { onStart: () => void }) {
  return (
    <div className="card lib-empty">
      <div className="lib-empty-shelf" aria-hidden="true">
        <span className="book-slot">
          <Icon name="plus" />
        </span>
        <span className="plank" />
      </div>
      <div>
        <h2>Полка пока пустая</h2>
        <p>
          {BOOKS_ENABLED
            ? "Загрузи первый учебник. Timely прочитает его, разобьёт на главы и составит программу со ссылками на страницы."
            : "Добавь первый предмет, а занятия по нему поможет поставить слайм."}
        </p>
        <button type="button" className="btn btn-main" onClick={onStart}>
          {BOOKS_ENABLED ? "Загрузить первую книгу" : "Добавить предмет"}
        </button>
      </div>
    </div>
  );
}

/**
 * «Добавить книгу» в шапке.
 *
 * Книга всегда лежит в предмете. Предмет один: вопроса нет. Предметов нет: сначала
 * цель, потом книга. Несколько: спрашиваем, куда положить.
 */
function AddBookButton({
  subjects,
  onAddBook,
  onAddSubject,
}: {
  subjects: readonly CatalogSubject[];
  onAddBook: (goalId: string) => void;
  onAddSubject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const named = subjects.filter((subject) => subject.goalId);

  if (named.length <= 1) {
    return (
      <button
        type="button"
        className="btn btn-line"
        onClick={() => (named[0]?.goalId ? onAddBook(named[0].goalId) : onAddSubject())}
      >
        Добавить книгу
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="btn btn-line">
          Добавить книгу
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`${paperPopover} min-w-[200px] max-w-[300px]`}>
        <div className="cur-menu">
          <p className="cur-menu-note">К какому предмету?</p>
          {named.map((subject) => (
            <button
              key={subject.goalId}
              type="button"
              onClick={() => onAddBook(subject.goalId as string)}
            >
              {subject.title}
            </button>
          ))}
          <hr />
          <button type="button" onClick={onAddSubject}>
            Новый предмет
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────── Предмет ────────────────────────────────────

interface CourseRow {
  plan: CoursePlanSummary;
  source: CatalogSource | null;
}

function SubjectCard({
  subject,
  ingestion,
  progress,
  progressLoaded,
  onAddBook,
  onContinueSetup,
  onShowProgress,
  onChanged,
}: {
  subject: CatalogSubject;
  ingestion: IngestionMap;
  progress: Map<string, CourseProgress>;
  progressLoaded: boolean;
  onAddBook: (goalId: string) => void;
  onContinueSetup: (goal: LearningGoal) => void;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
  onChanged: () => Promise<void>;
}) {
  const courses: CourseRow[] = [
    ...subject.sources.flatMap((source) => source.plans.map((plan) => ({ plan, source }))),
    ...subject.orphanPlans.map((plan) => ({ plan, source: null })),
  ];
  const needsSetup = Boolean(subject.goal && !subject.goal.normalization_confirmed);
  const cardRef = useRef<HTMLElement>(null);
  const cardWidth = useElementWidth(cardRef, 0);
  const perShelf = Math.max(MIN_BOOKS_PER_SHELF, Math.floor((cardWidth - SHELF_INSET_PX) / BOOK_SLOT_PX));
  const shelves = chunk(subject.sources, perShelf);

  const title = (
    <h2>
      {subject.title}
      {subject.direction ? <small> {subject.direction}</small> : null}
    </h2>
  );

  const line = (course: CourseRow) => (
    <CourseLine
      course={course}
      goal={subject.goal}
      progress={progress.get(course.plan.id) ?? null}
      progressLoaded={progressLoaded}
    />
  );

  return (
    <section ref={cardRef} className="cab card">
      {subject.goalId ? (
        <span className="cab-tools">
          <SubjectMenu
            subject={subject}
            courses={courses}
            onAddBook={onAddBook}
            onChanged={onChanged}
          />
        </span>
      ) : null}

      {courses.length === 1 ? (
        <Link className="shelf-head" href={planHref(courses[0].plan)}>
          {title}
          {line(courses[0])}
        </Link>
      ) : (
        <div className="shelf-head">
          {title}
          {courses.length === 0 ? (
            <span className="cab-line">
              <span className="fin">{emptyCourseLine(subject, ingestion)}</span>
            </span>
          ) : (
            <ul className="cab-courses">
              {courses.map((course) => (
                <li key={course.plan.id}>
                  <Link className="cab-course" href={planHref(course.plan)}>
                    <span className="cab-course-t">{cleanDocumentTitle(course.plan.title)}</span>
                    {line(course)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {needsSetup && subject.goal ? (
        <p className="cab-setup">
          Цель ещё не уточнена.{" "}
          <button
            type="button"
            className="link"
            onClick={() => onContinueSetup(subject.goal as LearningGoal)}
          >
            Уточнить
          </button>
        </p>
      ) : null}

      <div className="shelves">
        {shelves.length === 0 ? (
          <EmptyShelf subject={subject} onAddBook={onAddBook} />
        ) : (
          shelves.map((row, rowIndex) => (
            <div key={rowIndex}>
              <ul className="books">
                {row.map((source, index) => (
                  <ShelfBook
                    key={sourceKey(source)}
                    source={source}
                    cover={coverClass(subject.title, rowIndex * perShelf + index)}
                    goalId={subject.goalId}
                    state={source.kind === "book" ? ingestion[source.document.id] ?? null : null}
                    onShowProgress={onShowProgress}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
              <span className="plank" aria-hidden="true" />
              <ul className="caps">
                {row.map((source) => (
                  <Caption key={sourceKey(source)} source={source} ingestion={ingestion} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <SourceNotes
        subject={subject}
        ingestion={ingestion}
        onShowProgress={onShowProgress}
        onChanged={onChanged}
      />
    </section>
  );
}

function planHref(plan: CoursePlanSummary): string {
  return `/dashboard/curriculum/plan/${plan.id}`;
}

function sourceKey(source: CatalogSource): string {
  return source.kind === "book" ? source.document.id : source.material.id;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

/** Что сказать над полкой, пока программы нет. */
function emptyCourseLine(subject: CatalogSubject, ingestion: IngestionMap): string {
  const books = booksOf(subject);
  if (books.some((book) => isSourceBusy(effectiveStatus(book.document, ingestion)))) {
    return "Программа появится, когда дочитаю книгу";
  }
  if (subject.sources.length === 0) {
    return BOOKS_ENABLED ? "Пока нет ни одной книги" : "Программы пока нет";
  }
  if (
    books.length === subject.sources.length &&
    books.every((book) => effectiveStatus(book.document, ingestion) === "failed")
  ) {
    return "Книгу пока не получилось прочитать";
  }
  if (!subject.goalId) return "Эти книги не привязаны к предмету";
  return "Программы пока нет";
}

/** Прогресс курса и его срок. */
function CourseLine({
  course,
  goal,
  progress,
  progressLoaded,
}: {
  course: CourseRow;
  goal: LearningGoal | null;
  progress: CourseProgress | null;
  progressLoaded: boolean;
}) {
  const { plan, source } = course;

  if (plan.status !== "active") {
    return (
      <span className="cab-line">
        <span className={plan.status === "rejected" ? "fin tight" : "fin"}>{planStatusLine(plan)}</span>
      </span>
    );
  }

  // Материал считает пройденное сам, а занятия расписания могли ещё не начаться.
  const fromSource =
    source?.kind === "material"
      ? percentOf(source.material.completed_units, source.material.total_units)
      : 0;
  const percent = Math.max(progress?.percent ?? 0, fromSource);
  const finish = courseFinishLine(plan.forecast_finish_date, goal?.desired_finish_date, dayMonth);

  return (
    <>
      <span className="cab-line">
        <span
          className="tube"
          role="progressbar"
          aria-label="Пройдено"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          {percent > 0 ? <i style={{ width: `${percent}%` }} /> : null}
        </span>
        {progressLoaded || percent > 0 ? <span className="num">{percent}%</span> : null}
      </span>
      {finish ? <span className={finish.tight ? "fin tight" : "fin"}>{finish.text}</span> : null}
      {!source ? <span className="fin">Источник удалён</span> : null}
    </>
  );
}

function planStatusLine(plan: CoursePlanSummary): string {
  if (plan.status === "rejected") return "Программу забраковала проверка, её надо построить заново";
  if (plan.status === "awaiting_approval") return "Программа готова, осталось её подтвердить";
  return "Программа ещё проверяется";
}

// ─────────────────────────────── Меню предмета ───────────────────────────────

function SubjectMenu({
  subject,
  courses,
  onAddBook,
  onChanged,
}: {
  subject: CatalogSubject;
  courses: CourseRow[];
  onAddBook: (goalId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // Форма раскрывается в том же листе: второй всплывающий слой пришлось бы
  // открывать, пока закрывается первый, и он тут же закрывался бы вместе с ним.
  const [adding, setAdding] = useState(false);
  const goalId = subject.goalId as string;
  const orphans = courses.filter((course) => !course.source);

  const close = () => {
    setOpen(false);
    setAdding(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAdding(false);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="icon-btn" aria-label={`Действия: ${subject.title}`} title="Действия">
          <Icon name="more" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={
          adding
            ? `${paperPopover} w-[320px] max-w-[calc(100vw-32px)] p-4`
            : `${paperPopover} min-w-[188px] max-w-[280px]`
        }
      >
        {adding ? (
          <AddSourceForm goalId={goalId} onAdded={onChanged} onClose={close} />
        ) : (
          <div className="cur-menu">
            {BOOKS_ENABLED ? (
              <button type="button" onClick={() => onAddBook(goalId)}>
                Загрузить книгу
              </button>
            ) : null}
            <button type="button" onClick={() => setAdding(true)}>
              Добавить ссылку или задачник
            </button>
            <hr />
            {orphans.map(({ plan }) => (
              <ConfirmingAction
                key={plan.id}
                label={`Удалить программу «${cleanDocumentTitle(plan.title)}»`}
                confirm="Точно удалить?"
                onRun={async () => {
                  await deletePlan(plan.id);
                  await onChanged();
                }}
                onDone={close}
              />
            ))}
            <ConfirmingAction
              label="Удалить предмет"
              confirm="Удалить со всем содержимым?"
              onRun={async () => {
                await deleteGoal(goalId);
                await onChanged();
              }}
              onDone={close}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────── Полка ──────────────────────────────────────

function EmptyShelf({
  subject,
  onAddBook,
}: {
  subject: CatalogSubject;
  onAddBook: (goalId: string) => void;
}) {
  if (!subject.goalId || !BOOKS_ENABLED) return null;
  const goalId = subject.goalId;
  return (
    <div>
      <ul className="books">
        <li>
          <button
            type="button"
            className="book-slot"
            aria-label={`Загрузить книгу: ${subject.title}`}
            title="Загрузить книгу"
            onClick={() => onAddBook(goalId)}
          >
            <Icon name="plus" />
          </button>
        </li>
      </ul>
      <span className="plank" aria-hidden="true" />
      <ul className="caps">
        <li className="is-wide">Загрузить книгу</li>
      </ul>
    </div>
  );
}

function sourceTitle(source: CatalogSource): string {
  return source.kind === "book" ? coverTitle(source.document.title) : source.material.title;
}

const DOCUMENT_TYPES: Record<string, string> = {
  textbook: "Учебник",
  problem_set: "Задачник",
  notes: "Конспект",
  handout: "Методичка",
};

function ShelfBook({
  source,
  cover,
  goalId,
  state,
  onShowProgress,
  onChanged,
}: {
  source: CatalogSource;
  cover: string;
  goalId: string | null;
  state: IngestionState | null;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
  onChanged: () => Promise<void>;
}) {
  const title = sourceTitle(source);
  const book = source.kind === "book" ? source.document : null;
  const material = source.kind === "material" ? source.material : null;
  const plan = source.plans[0] ?? null;

  const status = book ? (state?.ingestion_status ?? book.ingestion_status) : "ready";
  const reading = isSourceBusy(status);
  const failed = status === "failed";

  const kind = book ? DOCUMENT_TYPES[book.document_type] : kindLabel((material as StudyMaterial).kind);
  const author = book ? coverAuthor(book.authors) : "";
  const long = title.length > 20;
  const attach = `${book ? "Книга" : kind} «${title}»`;
  const className = [
    "book",
    cover,
    reading ? "reading" : "",
    failed ? "is-failed" : "",
    long ? "is-long" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <>
      <span className="cv-t">{title}</span>
      {author ? <small>{author}</small> : null}
      {kind ? <em>{kind}</em> : null}
      {reading ? <i className="scan" aria-hidden="true" /> : null}
    </>
  );

  let bookNode;
  if (plan) {
    bookNode = (
      <Link className={className} href={planHref(plan)} data-attach={attach} title={title}>
        {inner}
      </Link>
    );
  } else if (book) {
    bookNode = (
      <button
        type="button"
        className={className}
        data-attach={attach}
        title={title}
        onClick={() => onShowProgress(goalId, book)}
      >
        {inner}
      </button>
    );
  } else if (material?.url) {
    bookNode = (
      <a
        className={className}
        href={material.url}
        target="_blank"
        rel="noreferrer noopener"
        data-attach={attach}
        title={title}
      >
        {inner}
      </a>
    );
  } else {
    bookNode = (
      <span className={className} data-attach={attach} title={title}>
        {inner}
      </span>
    );
  }

  return (
    <li className="shelf-book">
      {bookNode}
      <OverflowMenu label={`Действия: ${title}`} triggerClassName="book-more">
        {(close) => (
          <>
            {material?.url && plan ? (
              <a href={material.url} target="_blank" rel="noreferrer noopener" onClick={close}>
                Открыть ссылку
              </a>
            ) : null}
            {source.plans.map((item) => (
              <ConfirmingAction
                key={item.id}
                label={
                  source.plans.length > 1
                    ? `Удалить программу «${cleanDocumentTitle(item.title)}»`
                    : "Удалить программу"
                }
                confirm="Точно удалить?"
                onRun={async () => {
                  await deletePlan(item.id);
                  await onChanged();
                }}
                onDone={close}
              />
            ))}
            <ConfirmingAction
              label={book ? "Убрать книгу" : "Убрать источник"}
              confirm="Точно убрать?"
              onRun={async () => {
                if (book) await deleteDocument(book.id);
                else await deleteMaterial((material as StudyMaterial).id);
                await onChanged();
              }}
              onDone={close}
            />
          </>
        )}
      </OverflowMenu>
    </li>
  );
}

/** Подпись под книгой: объём, шаг обработки или что пошло не так. */
function Caption({ source, ingestion }: { source: CatalogSource; ingestion: IngestionMap }) {
  if (source.kind === "material") {
    const { completed_units: done, total_units: total, units_word: word } = source.material;
    return <li title={`${done} из ${total} ${word}`}>{total > 0 ? `${done} из ${total}` : ""}</li>;
  }

  const status = effectiveStatus(source.document, ingestion);
  if (status === "failed") {
    return <li className="is-bad">{ingestion[source.document.id]?.stalled ? "прервалась" : "не прочиталась"}</li>;
  }
  if (isSourceBusy(status)) {
    const state = ingestion[source.document.id];
    return (
      <li className="on" title={state?.step_label}>
        {state?.step_index ? `шаг ${state.step_index} из ${state.step_total}` : "читаю…"}
      </li>
    );
  }
  return <li>{source.document.page_count > 0 ? `${source.document.page_count} стр.` : ""}</li>;
}

/**
 * Под полкой то, что ждёт решения: книга не прочиталась или программу пора строить.
 *
 * Разбор ошибки здесь, а не в подсказке на обложке: на телефоне подсказок нет, а понять,
 * почему книга не прочиталась, надо сразу.
 */
function SourceNotes({
  subject,
  ingestion,
  onShowProgress,
  onChanged,
}: {
  subject: CatalogSubject;
  ingestion: IngestionMap;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
  onChanged: () => Promise<void>;
}) {
  const single = subject.sources.length === 1;
  const notes = subject.sources.flatMap((source) => {
    if (source.kind === "material") {
      if (source.plans.length > 0) return [];
      return [
        <MaterialNote
          key={source.material.id}
          material={source.material}
          onChanged={onChanged}
        />,
      ];
    }
    const { document } = source;
    const status = effectiveStatus(document, ingestion);
    const title = coverTitle(document.title);
    if (status === "failed") {
      const state = ingestion[document.id];
      const code = state?.job?.error_code ?? "";
      const scanNote =
        code === "ocr_quota" ? ocrNotice(document.ocr_summary, { hasProgram: true }) : null;
      const reason =
        scanNote ??
        (state?.stalled
          ? ingestionErrorMessage("stalled")
          : ingestionErrorMessage(code, state?.job?.error_message ?? ""));
      return [
        <li key={document.id} className="is-bad">
          <span>{single ? reason : `«${title}»: ${reason}`}</span>
          {BOOKS_ENABLED ? (
            <button
              type="button"
              className="btn btn-line"
              onClick={() => onShowProgress(subject.goalId, document)}
            >
              Разобраться
            </button>
          ) : null}
        </li>,
      ];
    }
    const named = (line: string) => (single ? line : `«${title}»: ${line}`);
    const rawScan =
      status === "ready"
        ? // Без книг повторной обработки нет, поэтому и строки «тогда нажми» тоже.
          ocrNotice(document.ocr_summary, {
            hasProgram: !BOOKS_ENABLED || source.plans.length > 0,
          })
        : null;
    const scanLine = rawScan === null ? null : named(rawScan);
    if (status === "ready" && source.plans.length > 0) {
      const rawProfiling = planProfilingNotice(
        source.plans.flatMap((plan) => plan.generation_warnings ?? []),
      );
      const profiling = rawProfiling === null ? null : named(rawProfiling);
      return [scanLine, profiling].flatMap((line) =>
        line ? [<li key={`${document.id}-${line}`}><span>{line}</span></li>] : [],
      );
    }
    const redo =
      scanLine !== null ? (
        <RetryScansNote
          key={`${document.id}-scans`}
          document={document}
          line={scanLine}
          canRetry={BOOKS_ENABLED && canRecognizeLater(document.ocr_summary)}
          onChanged={onChanged}
        />
      ) : null;
    // Без предмета программу не построить: не с чем её связать.
    if (status === "ready" && source.plans.length === 0 && subject.goalId) {
      return [
        ...(redo ? [redo] : []),
        <li key={document.id}>
          <span>{single ? "Книга прочитана." : `Книга «${title}» прочитана.`}</span>
          {BOOKS_ENABLED ? (
            <button
              type="button"
              className="btn btn-line"
              onClick={() => onShowProgress(subject.goalId, document)}
            >
              Построить программу
            </button>
          ) : null}
        </li>,
      ];
    }
    return redo ? [redo] : [];
  });

  return notes.length > 0 ? <ul className="cab-notes">{notes}</ul> : null;
}

function RetryScansNote({
  document,
  line,
  canRetry,
  onChanged,
}: {
  document: CurriculumDocument;
  line: string;
  canRetry: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const retry = async () => {
    setBusy(true);
    setFailure("");
    try {
      await startIngestion(document.id);
      await onChanged();
    } catch (error) {
      if (error instanceof CurriculumApiError && error.code === "ai_usage_limit_exceeded") {
        const payload = (error.payload ?? {}) as { reset_at?: unknown };
        setFailure(limitMessage(payload.reset_at));
      } else {
        setFailure(error instanceof Error ? error.message : "Не удалось запустить обработку.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <span>{line}</span>
      {canRetry ? (
        <button type="button" className="btn btn-line" disabled={busy} onClick={() => void retry()}>
          {busy ? "Запускаю…" : "Обработать заново"}
        </button>
      ) : null}
      {failure ? <span className="cab-note-error">{failure}</span> : null}
    </li>
  );
}

function MaterialNote({
  material,
  onChanged,
}: {
  material: StudyMaterial;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const build = async () => {
    setBusy(true);
    setFailure("");
    try {
      await generateMaterialPlan(material.id);
      await onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Не удалось рассчитать.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={failure ? "is-bad" : undefined}>
      <span>{failure || `«${material.title}»: занятия ещё не рассчитаны.`}</span>
      <button type="button" className="btn btn-line" disabled={busy} onClick={() => void build()}>
        {busy ? "Считаю…" : "Рассчитать занятия"}
      </button>
    </li>
  );
}
