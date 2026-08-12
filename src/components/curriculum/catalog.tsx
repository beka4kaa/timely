// Каталог предметов: с чего начинается раздел «Курс по книге».
//
// Форма — сгруппированный список, а не таблица. Таблица здесь уже была и
// ломалась предсказуемо: у предмета без источников и у источника с программой
// разное число значимых полей, поэтому самая широкая колонка стояла заполненная
// прочерками.
//
// Строка отвечает на вопрос «что у меня есть», а есть у ученика либо
// программа, либо пока только источник. Поэтому главным в строке стоит
// результат, а источник уходит в подпись под ним.
//
// ИСТОЧНИК — НЕ ТОЛЬКО КНИГА. К SAT готовятся по странице College Board и
// набору practice-тестов, к механике — по задачнику. Для ученика это один
// список: «то, по чему я занимаюсь». Книга и материал приходят разными
// запросами, но соединяются в `buildCatalog` в единый `CatalogSource`, и
// строка не знает, какого рода источник она печатает, — кроме подписи типа.
//
// Данные собираются четырьмя существующими list-запросами. Отдельного
// эндпоинта у каталога нет намеренно: он был бы пятым контрактом, который надо
// держать в согласии с четырьмя.

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
  type StudyMaterial,
  deleteDocument,
  deleteGoal,
  deleteMaterial,
  deletePlan,
  generateMaterialPlan,
  listDocuments,
  listGoals,
  listMaterials,
  listPlans,
} from "@/lib/curriculum-api";
import {
  type CatalogSource,
  type CatalogSubject,
  booksOf,
  buildCatalog,
} from "@/lib/curriculum-catalog";
import { PHASES, phaseIndexFor } from "@/lib/curriculum-progress";
import { cleanDocumentTitle } from "@/lib/curriculum-title";

import { AddSource } from "./add-source";
import { kindLabel } from "./add-source.logic";
import {
  paperCaption,
  paperCard,
  paperFocus,
  paperNumber,
  paperPrimaryButton,
  paperRule,
} from "./paper";

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

const ACTION = `text-[12px] text-[#8a5b24] underline-offset-2 transition-colors hover:underline ${paperFocus} rounded-sm`;
const QUIET_ACTION = `text-[12px] text-[#9b9186] underline-offset-2 transition-colors hover:text-[#6f675e] hover:underline ${paperFocus} rounded-sm`;
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
      const [goals, documents, plans, materials] = await Promise.all([
        listGoals(),
        listDocuments(),
        listPlans(),
        listMaterials(),
      ]);
      setSubjects(buildCatalog(goals, documents, plans, materials));
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
  // ровно тот «вечный спиннер», от которого раздел уже уходил. Материалы сюда
  // не попадают: обрабатывать в них нечего.
  const waiting = (subjects || []).some((subject) =>
    booksOf(subject).some(
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

  const sourceCount = subjects.reduce(
    (sum, subject) => sum + subject.sources.length,
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
    // элемент containing block для `position: fixed` потомков.
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
              {sourceCount > 0 ? (
                <>
                  {" · "}
                  <span className={paperNumber}>{sourceCount}</span>{" "}
                  {plural(sourceCount, "источник", "источника", "источников")}
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
        <p className="rounded-[14px] bg-[#fdf3f1] px-4 py-3 text-[13px] text-[#8c4b41]">
          {error}
        </p>
      ) : null}

      {subjects.length === 0 ? (
        <p className="rounded-[16px] bg-[#f2ede4] px-4 py-12 text-center text-[14px] text-[#8d857b]">
          Добавьте предмет — к нему можно приложить учебник, ссылку или набор
          тестов.
        </p>
      ) : (
        <div className="space-y-4">
          {subjects.map((subject) => (
            <SubjectSection
              key={subject.goalId || "unsorted"}
              subject={subject}
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
    <section className={`${paperCard} overflow-hidden`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5">
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

        {/* У группы «Без предмета» цели нет: ни добавлять источник, ни удалять
            нечего — там лежит то, что потеряло владельца. */}
        {subject.goalId ? (
          <span className="flex shrink-0 items-center gap-x-3">
            {needsSetup && subject.goal ? (
              <button
                type="button"
                className={ACTION}
                onClick={() => onContinueSetup(subject.goal as LearningGoal)}
              >
                уточнить цель
              </button>
            ) : null}
            <OverflowMenu label="Действия предмета">
              <button
                type="button"
                className={QUIET_ACTION}
                onClick={() => onAddBook(subject.goalId as string)}
              >
                загрузить книгу
              </button>
              <ConfirmingAction
                label="удалить предмет"
                confirm="удалить со всем содержимым?"
                onRun={async () => {
                  await deleteGoal(subject.goalId as string);
                  await onChanged();
                }}
              />
            </OverflowMenu>
          </span>
        ) : null}
      </header>

      {subject.sources.length === 0 && subject.orphanPlans.length === 0 ? (
        <p className={`${paperRule} px-4 py-3 text-[13px] text-[#a1978b]`}>
          Источников пока нет
        </p>
      ) : (
        <ul>
          {subject.sources.map((source) => (
            <SourceRow
              key={sourceKey(source)}
              source={source}
              goalId={subject.goalId}
              onShowProgress={onShowProgress}
              onChanged={onChanged}
            />
          ))}
          {subject.orphanPlans.map((plan) => (
            <li
              key={plan.id}
              className={`${paperRule} flex flex-wrap items-baseline gap-x-4 px-4 py-3`}
            >
              <Link
                href={`/dashboard/curriculum/plan/${plan.id}`}
                className={`${LINK} min-w-0 flex-1`}
              >
                {cleanDocumentTitle(plan.title)}
              </Link>
              <span className="text-[12px] text-[#a1978b]">источник удалён</span>
              <OverflowMenu label="Действия программы">
                <ConfirmingAction
                  label="удалить программу"
                  confirm="точно?"
                  onRun={async () => {
                    await deletePlan(plan.id);
                    await onChanged();
                  }}
                />
              </OverflowMenu>
            </li>
          ))}
        </ul>
      )}

      {subject.goalId ? (
        <div className={`${paperRule} px-3 py-2`}>
          <AddSource goalId={subject.goalId} onAdded={onChanged} />
        </div>
      ) : null}
    </section>
  );
}

function sourceKey(source: CatalogSource): string {
  return source.kind === "book" ? source.document.id : source.material.id;
}

/**
 * Строка источника — одна на книгу и на материал.
 *
 * Различий ровно три: подпись типа, чем меряется объём и что предлагается
 * сделать, пока программы нет. Всё остальное — общее, и разводить два похожих
 * компонента ради этих трёх мест значило бы чинить каждую правку дважды.
 */
function SourceRow({
  source,
  goalId,
  onShowProgress,
  onChanged,
}: {
  source: CatalogSource;
  goalId: string | null;
  onShowProgress: (goalId: string | null, document: CurriculumDocument) => void;
  onChanged: () => Promise<void>;
}) {
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const { plans } = source;

  const book = source.kind === "book" ? source.document : null;
  const material = source.kind === "material" ? source.material : null;
  const ready = book ? book.ingestion_status === "ready" : true;
  const failed = book ? book.ingestion_status === "failed" : false;

  const title = book
    ? cleanDocumentTitle(book.title)
    : (material as StudyMaterial).title;

  // Подпись типа несёт то, чего не несёт иконка: что именно означает число
  // рядом. «682 стр.» и «4 из 10» — разные вещи, и различает их только тип.
  const typeLabel = book ? "Книга" : kindLabel((material as StudyMaterial).kind);
  const volume = book
    ? `${book.page_count} стр.`
    : `${(material as StudyMaterial).completed_units} из ${
        (material as StudyMaterial).total_units
      } ${(material as StudyMaterial).units_word}`;

  // Программа по материалу называется так же, как сам материал: считать её
  // нечего переименовывать. Печатать «SAT Practice Tests» двумя строками
  // подряд — сообщать одно и то же дважды, поэтому такая строка схлопывается
  // в одну, где ссылкой становится само название источника.
  const planTitles = plans.map((plan) => cleanDocumentTitle(plan.title));
  const mergedPlan =
    plans.length === 1 && planTitles[0] === title ? plans[0] : null;

  const buildMaterialPlan = async () => {
    if (!material) return;
    setBusy(true);
    setFailure("");
    try {
      await generateMaterialPlan(material.id);
      await onChanged();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Не удалось рассчитать.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`${paperRule} px-4 py-3`}>
      {mergedPlan
        ? null
        : plans.map((plan) => (
            <div key={plan.id} className="flex flex-wrap items-baseline gap-x-4">
              <Link
                href={`/dashboard/curriculum/plan/${plan.id}`}
                className={`${LINK} min-w-0 flex-1`}
              >
                {cleanDocumentTitle(plan.title)}
              </Link>
            </div>
          ))}

      {/* Просторно — одна строка. Тесно — она разворачивается в две: сверху
          название и «⋯», под ними объём и статус. Название важнее объёма, и
          отдавать ему полстроки, чтобы уместить рядом «513 стр.», значит
          обрезать его первым. */}
      <div
        className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${
          plans.length > 0 && !mergedPlan ? "mt-1" : ""
        }`}
      >
        <span
          className={`order-1 min-w-0 flex-1 truncate @[560px]/page:order-none ${
            plans.length > 0 && !mergedPlan
              ? "text-[13px] text-[#8d857b]"
              : "text-[14px] text-[#3b352f]"
          }`}
          title={book ? book.title : title}
        >
          {mergedPlan ? (
            <Link
              href={`/dashboard/curriculum/plan/${mergedPlan.id}`}
              className={LINK}
            >
              {title}
            </Link>
          ) : material?.url ? (
            <a
              href={material.url}
              target="_blank"
              rel="noreferrer noopener"
              className={`underline-offset-2 hover:underline ${paperFocus} rounded-sm`}
            >
              {title}
            </a>
          ) : (
            title
          )}
        </span>

        <span className="order-3 flex w-full min-w-0 items-baseline gap-x-3 @[560px]/page:order-none @[560px]/page:w-auto">
          <span className={paperCaption}>{typeLabel}</span>
          <Volume
            percent={
              book
                ? pagesPercent(book.page_count)
                : donePercent(material as StudyMaterial)
            }
            label={volume}
          />

          {failed ? (
            <span className="text-[12px] text-[#a35c48]">
              не удалось обработать
            </span>
          ) : book && !ready ? (
            <span className="text-[12px] text-[#8a7a5e]">
              {PHASES[phaseIndexFor(book.ingestion_status)]?.label ||
                "обработка"}
            </span>
          ) : null}
        </span>

        {/* «⋯» идёт сразу за названием, чтобы остаться с ним на одной строке,
            когда объём уходит вниз. */}
        <span className="order-2 flex shrink-0 items-center gap-x-3 @[560px]/page:order-none">
          {book && !ready ? (
            <button
              type="button"
              className={ACTION}
              onClick={() => onShowProgress(goalId, book)}
            >
              {failed ? "разобраться" : "подробнее"}
            </button>
          ) : plans.length === 0 && book ? (
            <button
              type="button"
              className={ACTION}
              onClick={() => onShowProgress(goalId, book)}
            >
              построить программу
            </button>
          ) : plans.length === 0 && material ? (
            <button
              type="button"
              className={ACTION}
              disabled={busy}
              onClick={() => void buildMaterialPlan()}
            >
              {busy ? "считаю…" : "рассчитать занятия"}
            </button>
          ) : null}

          {/* Одно меню на строку, а не по одному на программу и на источник:
              два «⋯» подряд на одной карточке читаются как сбой вёрстки. */}
          <OverflowMenu label="Действия источника">
            {plans.map((plan) => (
              <ConfirmingAction
                key={plan.id}
                label="удалить программу"
                confirm="точно?"
                onRun={async () => {
                  await deletePlan(plan.id);
                  await onChanged();
                }}
              />
            ))}
            <ConfirmingAction
              label="убрать источник"
              confirm="убрать?"
              onRun={async () => {
                if (book) await deleteDocument(book.id);
                else await deleteMaterial((material as StudyMaterial).id);
                await onChanged();
              }}
            />
          </OverflowMenu>
        </span>
      </div>

      {failure ? (
        <p className="mt-1 text-[12px] text-[#a35c48]">{failure}</p>
      ) : null}
    </li>
  );
}

function pagesPercent(pages: number): number | null {
  if (!pages || pages <= 0) return null;
  return Math.max(
    THICKNESS_MIN_PERCENT,
    Math.min(100, (pages / THICKNESS_FULL_PAGES) * 100),
  );
}

function donePercent(material: StudyMaterial): number | null {
  if (!material.total_units) return null;
  return Math.min(100, (material.completed_units / material.total_units) * 100);
}

/**
 * Объём источника: полоса и число рядом.
 *
 * Не украшение. Учебник на 513 страниц и случайно залитый файл на 2 страницы в
 * списке выглядели одинаково, и отличить их можно было только вчитавшись в
 * цифру. Полоса показывает разницу раньше, чем глаз доходит до числа, — а само
 * число остаётся рядом, потому что «примерно вот столько» тут недостаточно.
 *
 * У книги полоса меряет толщину, у материала — пройденное. Общее у них то,
 * что глазу нужен масштаб, а не только цифра.
 */
function Volume({ percent, label }: { percent: number | null; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      {percent === null ? null : (
        <span
          aria-hidden
          className="block h-[3px] w-16 rounded-full bg-[#ece7de]"
        >
          <span
            className="block h-full rounded-full bg-[#c2b7a6]"
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
      <span className={`${paperNumber} text-[12px] text-[#8d857b]`}>
        {label}
      </span>
    </span>
  );
}

/**
 * Разрушающие действия — всегда под «⋯», а не в строке.
 *
 * Раньше «удалить», «убрать» и «удалить программу» стояли в ряд рядом с
 * «построить программу» одинаковым серым текстом. Шесть действий одного веса
 * не образуют иерархии: глазу приходилось читать каждое, чтобы понять, какое
 * из них — то самое.
 */
function OverflowMenu({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={`${QUIET_ACTION} shrink-0 px-1 leading-none`}
        >
          ⋯
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto min-w-[180px] rounded-[12px] border-0 bg-[#fbfaf7] p-2 shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <span
          className="flex flex-col items-start gap-y-2"
          onClick={() => setOpen(false)}
        >
          {children}
        </span>
      </PopoverContent>
    </Popover>
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
        className={`${QUIET_ACTION} !text-[#a35c48]`}
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
      className={armed ? `${QUIET_ACTION} !text-[#a35c48]` : QUIET_ACTION}
      onClick={async (event) => {
        if (!armed) {
          // Первое нажатие не должно закрывать меню: подтверждать было бы
          // негде.
          event.stopPropagation();
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
