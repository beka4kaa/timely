// Каталог предметов: с чего начинается раздел «Курс по книге».
//
// Раньше здесь сразу открывался мастер, и построенные программы были доступны
// только по прямой ссылке: второй предмет начать было нельзя — мастер затирал
// текущий сеанс. Каталог делает видимым всё, что у ученика есть, и оставляет
// мастеру ровно одну роль — добавление.
//
// Данные собираются тремя существующими list-запросами и соединяются чистой
// функцией `buildCatalog`. Отдельного эндпоинта у каталога нет намеренно: он
// был бы четвёртым контрактом, который надо держать в согласии с тремя.

"use client";

import {
  AlertTriangle,
  BookPlus,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
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
  type CatalogBook,
  type CatalogSubject,
  buildCatalog,
  subjectState,
} from "@/lib/curriculum-catalog";
import { PHASES, phaseIndexFor } from "@/lib/curriculum-progress";

import {
  paperButton,
  paperCaption,
  paperCard,
  paperPrimaryButton,
  paperTile,
} from "./paper";

interface CatalogProps {
  onAddSubject: () => void;
  onAddBook: (goalId: string) => void;
}

const STATE_LABEL: Record<ReturnType<typeof subjectState>, string> = {
  empty: "Нет учебника",
  failed: "Ошибка обработки",
  processing: "Идёт обработка",
  ready_to_plan: "Готово к построению",
  has_plan: "Программа готова",
};

export function CurriculumCatalog({ onAddSubject, onAddBook }: CatalogProps) {
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
    <div className="space-y-4">
      {error ? (
        <div
          className={`${paperCard} flex items-start gap-3 px-5 py-4 text-[13px] text-[#7a4a3a]`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {subjects.length === 0 ? (
        <EmptyCatalog onAddSubject={onAddSubject} />
      ) : (
        subjects.map((subject) => (
          <SubjectCard
            key={subject.goalId || "unsorted"}
            subject={subject}
            onAddBook={onAddBook}
            onChanged={load}
          />
        ))
      )}

      {subjects.length > 0 ? (
        <button type="button" className={paperPrimaryButton} onClick={onAddSubject}>
          <Plus className="h-4 w-4" />
          Добавить предмет
        </button>
      ) : null}
    </div>
  );
}

function EmptyCatalog({ onAddSubject }: { onAddSubject: () => void }) {
  return (
    <div className={`${paperCard} px-6 py-10 text-center`}>
      <p className="text-[15px] text-[#4b453e]">
        Здесь появятся предметы, которые вы изучаете.
      </p>
      <p className="mt-1 text-[13px] text-[#8d857b]">
        Начните с одного: загрузите учебник — программа построится по его разделам.
      </p>
      <button
        type="button"
        className={`${paperPrimaryButton} mt-5`}
        onClick={onAddSubject}
      >
        <Plus className="h-4 w-4" />
        Добавить предмет
      </button>
    </div>
  );
}

function SubjectCard({
  subject,
  onAddBook,
  onChanged,
}: {
  subject: CatalogSubject;
  onAddBook: (goalId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const state = subjectState(subject);

  return (
    <section className={`${paperCard} px-5 py-4`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-[19px] tracking-[-0.01em] text-[#2f2a25]">
            {subject.title}
          </h2>
          {subject.direction ? (
            <p className="mt-0.5 text-[13px] text-[#8d857b]">{subject.direction}</p>
          ) : null}
        </div>
        <span className={paperCaption}>{STATE_LABEL[state]}</span>
      </header>

      <div className="mt-4 space-y-2">
        {subject.books.map((book) => (
          <BookRow key={book.document.id} book={book} onChanged={onChanged} />
        ))}
        {subject.orphanPlans.map((plan) => (
          <PlanRow key={plan.id} plan={plan} onChanged={onChanged} bookGone />
        ))}
        {subject.books.length === 0 && subject.orphanPlans.length === 0 ? (
          <p className="text-[13px] text-[#8d857b]">
            Учебника пока нет — добавьте книгу, чтобы построить программу.
          </p>
        ) : null}
      </div>

      {/* У группы «Без предмета» цели нет, добавлять книгу некуда. */}
      {subject.goalId ? (
        <footer className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={paperButton}
            onClick={() => onAddBook(subject.goalId as string)}
          >
            <BookPlus className="h-4 w-4" />
            Добавить книгу
          </button>
          <ConfirmingDelete
            label="Удалить предмет"
            confirm="Удалить вместе с книгами и программами?"
            onDelete={async () => {
              await deleteGoal(subject.goalId as string);
              await onChanged();
            }}
          />
        </footer>
      ) : null}
    </section>
  );
}

function BookRow({
  book,
  onChanged,
}: {
  book: CatalogBook;
  onChanged: () => Promise<void>;
}) {
  const { document, plans } = book;
  const ready = document.ingestion_status === "ready";
  const failed = document.ingestion_status === "failed";

  return (
    <div className={`${paperTile} px-4 py-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] text-[#3b352f]">{document.title}</span>
        <span className="text-[12px] text-[#8d857b]">
          {failed
            ? "Не удалось обработать"
            : ready
              ? `${document.page_count} стр.`
              : PHASES[phaseIndexFor(document.ingestion_status)]?.label ||
                "Обработка"}
        </span>
      </div>

      {plans.length > 0 ? (
        <div className="mt-2 space-y-1">
          {plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} onChanged={onChanged} />
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <ConfirmingDelete
          label="Удалить книгу"
          confirm="Удалить книгу и её программы?"
          onDelete={async () => {
            await deleteDocument(document.id);
            await onChanged();
          }}
        />
      </div>
    </div>
  );
}

function PlanRow({
  plan,
  onChanged,
  bookGone = false,
}: {
  plan: CoursePlanSummary;
  onChanged: () => Promise<void>;
  bookGone?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Link
        href={`/dashboard/curriculum/plan/${plan.id}`}
        className="text-[13px] text-[#8a5b24] underline-offset-2 hover:underline"
      >
        {plan.title}
      </Link>
      <div className="flex items-center gap-3">
        {bookGone ? (
          <span className="text-[12px] text-[#8d857b]">книга удалена</span>
        ) : null}
        <ConfirmingDelete
          label="Удалить"
          confirm="Удалить программу?"
          onDelete={async () => {
            await deletePlan(plan.id);
            await onChanged();
          }}
        />
      </div>
    </div>
  );
}

/**
 * Удаление в два нажатия.
 *
 * Отдельного диалога нет намеренно: удаляется своё и восстановлению не
 * подлежит, но и цена ошибки — не потеря месяцев работы. Второе нажатие рядом с
 * первым честнее модального окна, которое всё равно закрывают не глядя.
 */
function ConfirmingDelete({
  label,
  confirm,
  onDelete,
}: {
  label: string;
  confirm: string;
  onDelete: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Взведённое состояние снимается само: иначе кнопка так и останется красной
  // до перезагрузки, и следующее случайное нажатие удалит без вопросов.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        className={`${paperButton} !px-3 !py-1 !text-[12px]`}
        onClick={() => setArmed(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      className={`${paperButton} !px-3 !py-1 !text-[12px] !border-[#b4785f] !text-[#7a4a3a]`}
      onClick={async () => {
        setBusy(true);
        try {
          await onDelete();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      {confirm}
    </button>
  );
}
