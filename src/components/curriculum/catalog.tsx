// Каталог предметов: с чего начинается раздел «Курс по книге».
//
// Форма — сгруппированный список, а не таблица. Таблица здесь уже была и
// ломалась предсказуемо: у предмета без книг и у книги с программой разное
// число значимых полей, поэтому самая широкая колонка стояла заполненная
// прочерками, а строки без учебника выглядели одинаково.
//
// Строка отвечает на вопрос «что у меня есть», а есть у ученика либо
// программа, либо пока только книга. Поэтому главным в строке стоит результат,
// а книга уходит в подпись под ним.
//
// Данные собираются тремя существующими list-запросами и соединяются чистой
// функцией `buildCatalog`. Отдельного эндпоинта у каталога нет намеренно: он
// был бы четвёртым контрактом, который надо держать в согласии с тремя.

"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
} from "@/lib/curriculum-catalog";
import { PHASES, phaseIndexFor } from "@/lib/curriculum-progress";
import { cleanDocumentTitle } from "@/lib/curriculum-title";

import { paperFocus, paperNumber, paperPrimaryButton } from "./paper";

interface CatalogProps {
  onAddSubject: () => void;
  onAddBook: (goalId: string) => void;
  onContinueSetup: (goal: LearningGoal) => void;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
}

// Толщина книги: 800 страниц — полная ширина засечки. Потолок выбран по
// верхней границе школьного учебника, а не по максимуму в данных: иначе одна
// толстая книга сплющила бы все остальные в невидимые чёрточки.
const THICKNESS_FULL_PAGES = 800;
const THICKNESS_MIN_PERCENT = 6;

const ACTION = `text-[12px] text-[#9b9186] underline-offset-2 transition-colors hover:text-[#6f675e] hover:underline ${paperFocus} rounded-sm`;
const LINK = `font-serif text-[15px] text-[#8a5b24] underline-offset-4 hover:underline ${paperFocus} rounded-sm`;

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

  const bookCount = subjects.reduce(
    (sum, subject) => sum + subject.books.length,
    0,
  );
  const namedSubjects = subjects.filter((subject) => subject.goalId).length;

  return (
    // Запросы по ширине СОДЕРЖИМОГО, а не окна: панель съедает часть экрана, и
    // медиа-запрос на широком мониторе с растянутой панелью по-прежнему считал
    // бы место просторным.
    //
    // Контейнер именно здесь, а не на `<main>` или общей оболочке раздела:
    // `container-type: inline-size` включает `contain: layout`, а это делает
    // элемент containing block для `position: fixed` потомков. На `<main>`
    // такой контейнер перепривязал бы к нему полноэкранную доску и призрак
    // перетаскивания в расписании, которые считают координаты от окна.
    <div className="@container/page">
      {/* Вместо заголовка страницы — строка, которая работает: слева счёт,
          справа единственное главное действие. Название раздела печатает
          верхняя панель приложения, и повторять его здесь незачем. */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <p className="text-[13px] text-[#8d857b]">
          {namedSubjects > 0 ? (
            <>
              <span className={paperNumber}>{namedSubjects}</span>{" "}
              {plural(namedSubjects, "предмет", "предмета", "предметов")}
              {bookCount > 0 ? (
                <>
                  {" · "}
                  <span className={paperNumber}>{bookCount}</span>{" "}
                  {plural(bookCount, "книга", "книги", "книг")}
                </>
              ) : null}
            </>
          ) : (
            "Пока пусто"
          )}
        </p>
        <button type="button" className={paperPrimaryButton} onClick={onAddSubject}>
          <Plus className="h-4 w-4" />
          Добавить предмет
        </button>
      </div>

      {error ? (
        <p className="border-t border-[#e7e1d7] py-4 text-[13px] text-[#a35c48]">
          {error}
        </p>
      ) : null}

      {subjects.length === 0 ? (
        <p className="border-t border-[#e7e1d7] py-12 text-center text-[14px] text-[#8d857b]">
          Загрузите учебник — программа построится по его разделам.
        </p>
      ) : (
        subjects.map((subject) => (
          <SubjectSection
            key={subject.goalId || "unsorted"}
            subject={subject}
            onAddBook={onAddBook}
            onContinueSetup={onContinueSetup}
            onShowProgress={onShowProgress}
            onChanged={load}
          />
        ))
      )}
    </div>
  );
}

function SubjectSection({
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
  const needsSetup = Boolean(
    subject.goal && !subject.goal.normalization_confirmed,
  );

  return (
    <section className="border-t border-[#e7e1d7] py-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="min-w-0 font-serif text-[17px] text-[#2f2a25]">
          {subject.title}
          {subject.direction ? (
            <span className="text-[#a1978b]"> · </span>
          ) : null}
          {subject.direction ? (
            <span className="text-[15px] text-[#8d857b]">
              {subject.direction}
            </span>
          ) : null}
        </h2>

        {/* У группы «Без предмета» цели нет: ни добавлять книгу, ни удалять
            нечего — там лежат книги, потерявшие владельца. */}
        {subject.goalId ? (
          <RowActions>
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
              label="удалить"
              confirm="удалить со всем содержимым?"
              onRun={async () => {
                await deleteGoal(subject.goalId as string);
                await onChanged();
              }}
            />
          </RowActions>
        ) : null}
      </header>

      {subject.books.length === 0 && subject.orphanPlans.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#a1978b]">Учебника пока нет</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {subject.books.map((book) => (
            <BookRow
              key={book.document.id}
              book={book}
              goalId={subject.goalId}
              onShowProgress={onShowProgress}
              onChanged={onChanged}
            />
          ))}
          {subject.orphanPlans.map((plan) => (
            <li key={plan.id} className="flex flex-wrap items-baseline gap-x-4">
              <Link
                href={`/dashboard/curriculum/plan/${plan.id}`}
                className={`${LINK} min-w-0 flex-1`}
              >
                {plan.title}
              </Link>
              <span className="text-[12px] text-[#a1978b]">книга удалена</span>
              <ConfirmingAction
                label="удалить"
                confirm="точно?"
                onRun={async () => {
                  await deletePlan(plan.id);
                  await onChanged();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BookRow({
  book,
  goalId,
  onShowProgress,
  onChanged,
}: {
  book: CatalogBook;
  goalId: string | null;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
  onChanged: () => Promise<void>;
}) {
  const { document, plans } = book;
  const ready = document.ingestion_status === "ready";
  const failed = document.ingestion_status === "failed";
  const title = cleanDocumentTitle(document.title);

  const remove = (
    <ConfirmingAction
      label="убрать"
      confirm="убрать книгу?"
      onRun={async () => {
        await deleteDocument(document.id);
        await onChanged();
      }}
    />
  );

  return (
    <li>
      {plans.map((plan) => (
        <div
          key={plan.id}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5"
        >
          <Link
            href={`/dashboard/curriculum/plan/${plan.id}`}
            className={`${LINK} min-w-0 flex-1`}
          >
            {plan.title}
          </Link>
          <ConfirmingAction
            label="удалить программу"
            confirm="точно?"
            onRun={async () => {
              await deletePlan(plan.id);
              await onChanged();
            }}
          />
        </div>
      ))}

      {/* Просторно — одна строка. Тесно — она разворачивается в две: сверху
          название и «⋯», под ними объём и статус. Название важнее объёма, и
          отдавать ему полстроки, чтобы уместить рядом «513 стр.», значит
          обрезать его первым. */}
      <div
        className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${
          plans.length > 0 ? "mt-0.5" : ""
        }`}
      >
        <span
          className={`order-1 min-w-0 flex-1 truncate @[560px]/page:order-none ${
            plans.length > 0 ? "text-[13px] text-[#8d857b]" : "text-[14px] text-[#3b352f]"
          }`}
          title={document.title}
        >
          {title}
        </span>

        {/* Тесно этот блок занимает всю ширину и потому переносится под
            название — вместе со статусом, который иначе оторвался бы от
            объёма. Просторно он снова обычный элемент строки. */}
        <span className="order-3 flex w-full min-w-0 items-baseline gap-x-4 @[560px]/page:order-none @[560px]/page:w-auto">
          <Thickness pages={document.page_count} />

          {failed ? (
            <span className="text-[12px] text-[#a35c48]">не удалось обработать</span>
          ) : !ready ? (
            <span className="text-[12px] text-[#8a7a5e]">
              {PHASES[phaseIndexFor(document.ingestion_status)]?.label ||
                "обработка"}
            </span>
          ) : null}
        </span>

        {/* «⋯» идёт сразу за названием, чтобы остаться с ним на одной
            строке, когда объём уходит вниз. Просторно порядок сбрасывается и
            действия снова замыкают строку. */}
        <RowActions className="order-2 @[560px]/page:order-none">
          {!ready ? (
            <button
              type="button"
              className={ACTION}
              onClick={() => onShowProgress(goalId, document)}
            >
              {failed ? "разобраться" : "подробнее"}
            </button>
          ) : plans.length === 0 ? (
            <button
              type="button"
              className={ACTION}
              onClick={() => onShowProgress(goalId, document)}
            >
              построить программу
            </button>
          ) : null}
          {remove}
        </RowActions>
      </div>
    </li>
  );
}

/**
 * Действия строки: видны, когда есть место, и уходят под «⋯», когда тесно.
 *
 * Порог — по ширине КОНТЕЙНЕРА, а не окна: место съедает панель вопросов, и на
 * широком мониторе с растянутой панелью медиа-запрос по-прежнему считал бы
 * страницу просторной.
 *
 * Без этого каталог не ломался, а некрасиво распухал: текстовые действия
 * переносились на свои строки, и карточка предмета превращалась в лестницу.
 */
function RowActions({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <span className={`hidden shrink-0 gap-x-3 @[560px]/page:flex ${className}`}>
        {children}
      </span>

      <span className={`shrink-0 @[560px]/page:hidden ${className}`}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Действия"
              className={`${ACTION} px-1 leading-none`}
            >
              ⋯
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-auto min-w-[160px] border-[#dcd7cf] bg-[#fbfaf7] p-1.5"
          >
            <span
              className="flex flex-col items-start gap-y-2"
              onClick={() => setOpen(false)}
            >
              {children}
            </span>
          </PopoverContent>
        </Popover>
      </span>
    </>
  );
}

/**
 * Толщина книги: полоса, длина которой пропорциональна числу страниц.
 *
 * Не украшение. Учебник на 513 страниц и случайно залитый файл на 2 страницы в
 * списке выглядели одинаково, и отличить их можно было только вчитавшись в
 * цифру. Полоса показывает разницу раньше, чем глаз доходит до числа, — а само
 * число остаётся рядом, потому что «примерно вот столько» тут недостаточно.
 */
function Thickness({ pages }: { pages: number }) {
  if (!pages || pages <= 0) return null;
  const percent = Math.max(
    THICKNESS_MIN_PERCENT,
    Math.min(100, (pages / THICKNESS_FULL_PAGES) * 100),
  );

  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        aria-hidden
        className="block h-[3px] w-16 rounded-full bg-[#ece7de]"
      >
        <span
          className="block h-full rounded-full bg-[#c2b7a6]"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className={`${paperNumber} text-[12px] text-[#8d857b]`}>
        {pages} стр.
      </span>
    </span>
  );
}

/**
 * Опасное действие в два нажатия.
 *
 * Модального окна нет намеренно: удаляется своё, и второе нажатие ровно там же,
 * где первое, честнее диалога, который закрывают не глядя. Отказ сервера
 * показывается на месте — раньше кнопка просто гасла, и это выглядело как
 * поломка (сервер и правда отвечал 500 на удаление предмета с занятиями).
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

/** Русское склонение по числу. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
