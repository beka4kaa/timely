// Каталог предметов: с чего начинается раздел «Курс по книге».
//
// Форма — таблица, а не карточки. Карточка оправдана, когда у элемента есть
// содержание, которое нужно рассматривать; здесь у предмета три факта —
// название, книга и состояние, — и десяток предметов в карточках превращается
// в километр прокрутки, где одинаковые строки «Хочу…» неотличимы друг от друга.
// Таблица ставит эти факты в колонки, и глаз сравнивает их по вертикали.
//
// Данные собираются тремя существующими list-запросами и соединяются чистой
// функцией `buildCatalog`. Отдельного эндпоинта у каталога нет намеренно: он
// был бы четвёртым контрактом, который надо держать в согласии с тремя.

"use client";

import { AlertTriangle, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  type CoursePlanSummary,
  type CurriculumDocument,
  type LearningGoal,
  deleteDocument,
  deleteGoal,
  deletePlan,
  listDocuments,
  listGoals,
  listPlans,
} from "@/lib/curriculum-api";
import {
  type CatalogSubject,
  buildCatalog,
  subjectState,
} from "@/lib/curriculum-catalog";
import { PHASES, phaseIndexFor } from "@/lib/curriculum-progress";

import { paperCaption, paperFocus, paperPrimaryButton } from "./paper";

interface CatalogProps {
  onAddSubject: () => void;
  onAddBook: (goalId: string) => void;
  /** Вернуться к подтверждению разбора цели, если оно не пройдено. */
  onContinueSetup: (goal: LearningGoal) => void;
  /** Экран обработки книги или построения программы. */
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
}

const STATE_LABEL: Record<ReturnType<typeof subjectState>, string> = {
  empty: "нет учебника",
  failed: "ошибка",
  processing: "обработка",
  ready_to_plan: "готово к построению",
  has_plan: "программа готова",
};

// Состояние — единственное цветное пятно в таблице. Цвет здесь несёт смысл:
// красное требует внимания, зелёное его не требует, остальное нейтрально.
const STATE_TONE: Record<ReturnType<typeof subjectState>, string> = {
  empty: "text-[#a1978b]",
  failed: "text-[#a35c48]",
  processing: "text-[#8a7a5e]",
  ready_to_plan: "text-[#8a5b24]",
  has_plan: "text-[#5c7a52]",
};

const ROW = "border-t border-[#e7e1d7]";
const CELL = "py-3 pr-4 align-top";
const LINK = `text-[#8a5b24] underline-offset-2 hover:underline ${paperFocus} rounded-sm`;
const ACTION = `text-[12px] text-[#9b9186] underline-offset-2 hover:text-[#6f675e] hover:underline ${paperFocus} rounded-sm`;

export function CurriculumCatalog({
  onAddSubject,
  onAddBook,
  onContinueSetup,
  onShowProgress,
}: CatalogProps) {
  const [subjects, setSubjects] = useState<CatalogSubject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [goals, documents, plans] = await Promise.all([
        listGoals(),
        listDocuments(),
        listPlans(),
      ]);
      setSubjects(buildCatalog(goals, documents, plans));
      setError(null);
    } catch {
      setError("Не удалось загрузить каталог. Проверьте соединение.");
      setSubjects([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Пока хоть одна книга обрабатывается, каталог обновляется сам: обработка
  // идёт минутами, и заставлять человека жать F5, чтобы узнать её исход, —
  // ровно тот «вечный спиннер», от которого раздел уже уходил.
  const waiting = (subjects || []).some((subject) =>
    subject.books.some(
      (book) =>
        book.document.ingestion_status !== "ready" &&
        book.document.ingestion_status !== "failed",
    ),
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  if (subjects === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#a1978b]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="flex items-start gap-2 text-[13px] text-[#a35c48]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {subjects.length === 0 ? (
        <EmptyCatalog />
      ) : (
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="text-left">
              <th className={`${paperCaption} pb-2 pr-4 font-medium`}>Предмет</th>
              <th className={`${paperCaption} pb-2 pr-4 font-medium`}>Учебник</th>
              <th className={`${paperCaption} pb-2 pr-4 font-medium`}>Состояние</th>
              <th className={`${paperCaption} pb-2 font-medium`} />
            </tr>
          </thead>
          <tbody>
            {subjects.map((subject) => (
              <SubjectRows
                key={subject.goalId || "unsorted"}
                subject={subject}
                onAddBook={onAddBook}
                onContinueSetup={onContinueSetup}
                onShowProgress={onShowProgress}
                onChanged={load}
              />
            ))}
          </tbody>
        </table>
      )}

      <button type="button" className={paperPrimaryButton} onClick={onAddSubject}>
        <Plus className="h-4 w-4" />
        Добавить предмет
      </button>
    </div>
  );
}

function EmptyCatalog() {
  return (
    <div className="py-10 text-center">
      <p className="text-[15px] text-[#4b453e]">
        Здесь появятся предметы, которые вы изучаете.
      </p>
      <p className="mt-1 text-[13px] text-[#8d857b]">
        Начните с одного: загрузите учебник — программа построится по его разделам.
      </p>
    </div>
  );
}

/**
 * Предмет — это одна строка плюс по строке на каждую книгу сверх первой.
 *
 * Название предмета не повторяется в дочерних строках: повтор в таблице читается
 * как другой предмет с тем же именем. Пустая ячейка вместо него — обычный приём
 * для сгруппированных строк.
 */
function SubjectRows({
  subject,
  onAddBook,
  onContinueSetup,
  onShowProgress,
  onChanged,
}: {
  subject: CatalogSubject;
  onAddBook: (goalId: string) => void;
  onContinueSetup: (goal: LearningGoal) => void;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
  onChanged: () => Promise<void>;
}) {
  const state = subjectState(subject);
  const needsSetup = Boolean(
    subject.goal && !subject.goal.normalization_confirmed,
  );
  const rows = Math.max(1, subject.books.length);

  return (
    <>
      {subject.books.length === 0 ? (
        <tr className={ROW}>
          <SubjectCell subject={subject} rowSpan={1} />
          <td className={CELL}>
            <span className="text-[#a1978b]">—</span>
          </td>
          <td className={`${CELL} ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</td>
          <td className={`${CELL} text-right`}>
            <SubjectActions
              subject={subject}
              needsSetup={needsSetup}
              onAddBook={onAddBook}
              onContinueSetup={onContinueSetup}
              onChanged={onChanged}
            />
          </td>
        </tr>
      ) : (
        subject.books.map((book, index) => {
          const { document, plans } = book;
          const ready = document.ingestion_status === "ready";
          const failed = document.ingestion_status === "failed";
          return (
            <tr key={document.id} className={ROW}>
              {index === 0 ? (
                <SubjectCell subject={subject} rowSpan={rows} />
              ) : null}
              <td className={CELL}>
                <span className="text-[#3b352f]">{document.title}</span>
                {plans.length > 0 ? (
                  <span className="mt-1 flex flex-col gap-0.5">
                    {plans.map((plan) => (
                      <Link
                        key={plan.id}
                        href={`/dashboard/curriculum/plan/${plan.id}`}
                        className={`${LINK} text-[13px]`}
                      >
                        {plan.title}
                      </Link>
                    ))}
                  </span>
                ) : null}
              </td>
              <td className={CELL}>
                <BookState document={document} />
              </td>
              <td className={`${CELL} text-right`}>
                <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
                  {!ready ? (
                    <button
                      type="button"
                      className={ACTION}
                      onClick={() => onShowProgress(subject.goalId, document)}
                    >
                      {failed ? "разобраться" : "подробнее"}
                    </button>
                  ) : plans.length === 0 ? (
                    <button
                      type="button"
                      className={ACTION}
                      onClick={() => onShowProgress(subject.goalId, document)}
                    >
                      построить программу
                    </button>
                  ) : null}
                  <ConfirmingAction
                    label="убрать книгу"
                    confirm="точно убрать?"
                    onRun={async () => {
                      await deleteDocument(document.id);
                      await onChanged();
                    }}
                  />
                  {index === 0 ? (
                    <SubjectActions
                      subject={subject}
                      needsSetup={needsSetup}
                      onAddBook={onAddBook}
                      onContinueSetup={onContinueSetup}
                      onChanged={onChanged}
                    />
                  ) : null}
                </span>
              </td>
            </tr>
          );
        })
      )}

      {/* Программа, чья книга удалена: план живёт, ссылка обязана остаться. */}
      {subject.orphanPlans.map((plan) => (
        <tr key={plan.id} className={ROW}>
          <td className={CELL} />
          <td className={CELL}>
            <OrphanPlan plan={plan} />
          </td>
          <td className={`${CELL} text-[#a1978b]`}>книга удалена</td>
          <td className={`${CELL} text-right`}>
            <ConfirmingAction
              label="удалить"
              confirm="точно удалить?"
              onRun={async () => {
                await deletePlan(plan.id);
                await onChanged();
              }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

function SubjectCell({
  subject,
  rowSpan,
}: {
  subject: CatalogSubject;
  rowSpan: number;
}) {
  return (
    <td className={`${CELL} w-[34%]`} rowSpan={rowSpan}>
      <span className="block text-[#2f2a25]">{subject.title}</span>
      {subject.direction ? (
        <span className="mt-0.5 block text-[13px] text-[#8d857b]">
          {subject.direction}
        </span>
      ) : null}
    </td>
  );
}

function BookState({ document }: { document: CurriculumDocument }) {
  if (document.ingestion_status === "failed") {
    return <span className="text-[#a35c48]">ошибка</span>;
  }
  if (document.ingestion_status === "ready") {
    return (
      <span className="text-[#8d857b]">
        {document.page_count > 0 ? `${document.page_count} стр.` : "готов"}
      </span>
    );
  }
  return (
    <span className="text-[#8a7a5e]">
      {PHASES[phaseIndexFor(document.ingestion_status)]?.label || "обработка"}
    </span>
  );
}

function OrphanPlan({ plan }: { plan: CoursePlanSummary }) {
  return (
    <Link
      href={`/dashboard/curriculum/plan/${plan.id}`}
      className={`${LINK} text-[13px]`}
    >
      {plan.title}
    </Link>
  );
}

function SubjectActions({
  subject,
  needsSetup,
  onAddBook,
  onContinueSetup,
  onChanged,
}: {
  subject: CatalogSubject;
  needsSetup: boolean;
  onAddBook: (goalId: string) => void;
  onContinueSetup: (goal: LearningGoal) => void;
  onChanged: () => Promise<void>;
}) {
  // У группы «Без предмета» цели нет: ни добавлять книгу, ни удалять нечего.
  if (!subject.goalId) return null;

  return (
    <>
      {needsSetup && subject.goal ? (
        <button
          type="button"
          className={ACTION}
          onClick={() => onContinueSetup(subject.goal as LearningGoal)}
        >
          уточнить цель
        </button>
      ) : null}
      <button
        type="button"
        className={ACTION}
        onClick={() => onAddBook(subject.goalId as string)}
      >
        добавить книгу
      </button>
      <ConfirmingAction
        label="удалить предмет"
        confirm="удалить со всем содержимым?"
        onRun={async () => {
          await deleteGoal(subject.goalId as string);
          await onChanged();
        }}
      />
    </>
  );
}

/**
 * Опасное действие в два нажатия.
 *
 * Модального окна нет намеренно: удаляется своё, и второе нажатие ровно там же,
 * где первое, честнее диалога, который закрывают не глядя. Ошибка при этом
 * показывается на месте — раньше отказ сервера просто ничего не делал, и кнопка
 * выглядела сломанной.
 */
function ConfirmingAction({
  label,
  confirm,
  onRun,
}: {
  label: string;
  confirm: string;
  onRun: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (failed) {
    return (
      <button
        type="button"
        className={`${ACTION} !text-[#a35c48]`}
        onClick={() => {
          setFailed(false);
          setArmed(true);
        }}
      >
        не удалось, ещё раз?
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      className={armed ? `${ACTION} !text-[#a35c48]` : ACTION}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        try {
          await onRun();
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {busy ? "…" : armed ? confirm : label}
    </button>
  );
}
