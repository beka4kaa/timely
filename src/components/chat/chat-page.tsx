"use client";

// Страница «Тьютор»: разговор во весь экран.
//
// Слева история, посередине читаемая колонка, справа — где в книге мы читаем.
// Панель вопросов на этой странице не показывается (`config/rail-free-routes`):
// чат внутри чата бессмыслен.
//
// Полноэкранного режима, как у доски, здесь нет намеренно. Доска ушла в
// `fixed inset-0` и заплатила за это дублем шапки и рельса; `DashboardMain` уже
// `fixed` и уже вычел 48 px шапки и 58 px рельса, так что странице хватает
// `h-full`. Имя раздела печатает `SiteHeader` — своей шапки тоже не нужно.
//
// Разговор ведёт тот же движок, что и панель (`use-subject-chat`), реплики
// рисует тот же `AskTurn`, поле — тот же `Composer`. Разница только в
// раскладке и в размере шрифта.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  PanelLeftOpen,
  PanelRightOpen,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  listDocuments,
  listGoals,
  type CurriculumDocument,
} from "@/lib/curriculum-api";
import { buildSpines } from "@/lib/citation-spread";
import { subjectTitle } from "@/lib/curriculum-catalog";
import { FoldResizer } from "@/components/tutor-rail/fold-resizer";
import { AskTurn } from "./ask-turn";
import { ChatList } from "./chat-list";
import { Composer } from "./composer";
import { SourcesPanel } from "./sources-panel";
import { useFoldWidth } from "./use-fold-width";
import { useSubjectChat } from "./use-subject-chat";
import "katex/dist/katex.min.css";

interface Subject {
  goalId: string;
  title: string;
  books: number;
}

/** Тот же ключ, что у панели: «какой предмет открыт» — одно на приложение. */
const SUBJECT_KEY = "timely.ask.subject";
/** Значение ключа для разговора без книги. Пустая строка неотличима от «нет». */
const NO_BOOK = "none";

const MOBILE_BREAKPOINT = 768;

const SUGGESTIONS = ["Объясни проще", "Приведи пример", "С чего начать"];

export function ChatPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [documents, setDocuments] = useState<CurriculumDocument[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const chat = useSubjectChat({ goalId: selected, scope: "all" });
  const fold = useFoldWidth({
    storageKey: "timely.chat.sources.width",
    initial: 320,
    min: 240,
    max: 460,
    // Панель источников не должна съедать колонку чтения: она подпись, а не
    // содержание.
    maxShare: 0.34,
  });

  // На узком экране обе колонки становятся оверлеями и по умолчанию закрыты:
  // 264 + 320 px от семисот не оставили бы ничего самому разговору.
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setNarrow(mobile);
      if (mobile) {
        setListOpen(false);
        setSourcesOpen(false);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listGoals(), listDocuments()])
      .then(([goals, docs]) => {
        if (!alive) return;
        const readyByGoal = new Map<string, number>();
        for (const document of docs) {
          if (!document.goal || document.ingestion_status !== "ready") continue;
          readyByGoal.set(
            document.goal,
            (readyByGoal.get(document.goal) ?? 0) + 1,
          );
        }
        setSubjects(
          goals.map((goal) => ({
            goalId: goal.id,
            title: subjectTitle(goal),
            books: readyByGoal.get(goal.id) ?? 0,
          })),
        );
        setDocuments(docs);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Предмет по умолчанию — тот, что выбран в панели: «какая книга открыта» не
  // должно зависеть от того, с какого экрана ученик спрашивает. Явно выбранное
  // «без книги» тоже запоминается, иначе оно слетало бы при каждом заходе.
  useEffect(() => {
    if (!ready) return;
    const remembered = window.localStorage.getItem(SUBJECT_KEY);
    if (remembered === NO_BOOK) return;
    const known = subjects.find((item) => item.goalId === remembered);
    setSelected((known ?? subjects[0])?.goalId ?? null);
  }, [ready, subjects]);

  const pickSubject = useCallback(
    (goalId: string | null) => {
      setPickerOpen(false);
      if (goalId === selected) return;
      setSelected(goalId);
      window.localStorage.setItem(SUBJECT_KEY, goalId ?? NO_BOOK);
      // Книга у разговора одна: она записана в чате и после создания не
      // меняется — иначе в старых ответах остались бы цитаты из книги, которой
      // в предмете нет. Поэтому смена книги начинает новый разговор, а прежний
      // остаётся в истории слева.
      if (chat.turns.length) chat.startNew();
    },
    [selected, chat],
  );

  const openChat = useCallback(
    (id: string) => {
      // Разговор помнит свой предмет: продолжать физику, спрашивая по алгебре,
      // нельзя.
      const row = chat.chats.find((item) => item.id === id);
      if (row) setSelected(row.goal);
      if (narrow) setListOpen(false);
      void chat.openChat(id);
    },
    [chat, narrow],
  );

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat.turns]);

  const current = useMemo(
    () => subjects.find((item) => item.goalId === selected) ?? null,
    [subjects, selected],
  );

  const pageCounts = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc.page_count])),
    [documents],
  );
  const authors = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc.authors])),
    [documents],
  );
  const spines = useMemo(
    () => buildSpines(chat.turns, pageCounts),
    [chat.turns, pageCounts],
  );

  const jumpToTurn = useCallback((index: number) => {
    const node = document.getElementById(`turn-${index}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const empty = !chat.turns.length;

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-[#f7f5f1]">
      {/* ── История ─────────────────────────────────────────────────────── */}
      <aside
        // Позиционирование целиком в одной ветке: `absolute` и `relative`
        // рядом в одной строке классов спорят порядком в стилях Tailwind, а не
        // порядком в строке, и на узком экране колонка осталась бы в потоке.
        className={
          narrow
            ? `absolute inset-y-0 left-0 z-30 w-[280px] border-r border-[#dedbd4] bg-[#fbfaf7] shadow-[0_18px_60px_rgba(62,52,41,0.18)] transition-transform duration-200 ${
                listOpen ? "translate-x-0" : "-translate-x-full"
              }`
            : `shrink-0 border-r border-[#dedbd4] bg-[#fbfaf7] ${
                listOpen ? "w-[264px]" : "hidden"
              }`
        }
        inert={narrow && !listOpen ? true : undefined}
      >
        <ChatList
          chats={chat.chats}
          activeId={chat.chatId}
          loading={chat.loadingChats}
          onOpen={openChat}
          onCreate={() => {
            chat.startNew();
            if (narrow) setListOpen(false);
          }}
          onRename={(id, title) => void chat.renameChat(id, title)}
          onDelete={(id) => void chat.removeChat(id)}
          onCollapse={() => setListOpen(false)}
        />
      </aside>

      {/* ── Разговор ────────────────────────────────────────────────────── */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {!listOpen && (
          <EdgeButton
            side="left"
            label="История разговоров"
            onClick={() => setListOpen(true)}
          />
        )}
        {!sourcesOpen && (
          <EdgeButton
            side="right"
            label="Источники"
            onClick={() => setSourcesOpen(true)}
          />
        )}

        {/* Точечная сетка бумаги — та же, что на доске. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(rgba(120,108,92,0.10) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        {/* Лента и поле — в одной колонке. Поле НЕ переезжает между двумя
            ветками разметки: это один и тот же узел, и меняется только то, что
            стоит над ним. Два разных композера потеряли бы черновик и фокус
            ровно в момент первой отправки. */}
        <div
          className={`relative flex min-h-0 flex-1 flex-col ${
            empty ? "justify-center" : ""
          }`}
        >
          {!empty && (
            <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[46rem] space-y-6 px-6 py-8">
                {chat.turns.map((turn, index) => (
                  <AskTurn
                    key={index}
                    id={`turn-${index}`}
                    turn={turn}
                    variant="page"
                  />
                ))}
              </div>
            </div>
          )}

          {empty && (
            <div className="px-6 pb-6 text-center">
              <h1 className="font-serif text-[26px] font-semibold text-[#37322c]">
                Что разбираем?
              </h1>
              <p className="mt-2 text-[13px] text-[#8f887f]">
                {current
                  ? current.books
                    ? `Отвечу по книге предмета «${current.title}» со ссылкой на страницу.`
                    : `У предмета «${current.title}» пока нет обработанной книги — отвечу своими словами.`
                  : "Разговор без книги: отвечу своими словами, без ссылок на учебник."}
              </p>
            </div>
          )}

          <div className="mx-auto w-full max-w-[46rem] shrink-0 px-6 pb-6">
            <Composer
              variant="page"
              onSubmit={(text) => void chat.ask(text)}
              onStop={chat.stop}
              busy={chat.busy}
              placeholder={current ? "Спросите по книге…" : "Спросите что угодно…"}
              suggestions={empty ? SUGGESTIONS : undefined}
              left={
                <SubjectPicker
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  subjects={subjects}
                  selected={selected}
                  onSelect={pickSubject}
                />
              }
            />
          </div>
        </div>
      </div>

      {/* ── Источники ───────────────────────────────────────────────────── */}
      <aside
        style={{ width: narrow ? undefined : fold.width }}
        className={
          narrow
            ? `absolute inset-y-0 right-0 z-30 w-[300px] border-l border-[#dedbd4] bg-[#fbfaf7] shadow-[0_18px_60px_rgba(62,52,41,0.18)] transition-transform duration-200 ${
                sourcesOpen ? "translate-x-0" : "translate-x-full"
              }`
            : `relative shrink-0 border-l border-[#dedbd4] bg-[#fbfaf7] ${
                sourcesOpen ? "" : "hidden"
              }`
        }
        inert={narrow && !sourcesOpen ? true : undefined}
      >
        {!narrow && sourcesOpen && (
          <FoldResizer
            width={fold.width}
            dragging={fold.dragging}
            setWidth={fold.setWidth}
            setDragging={fold.setDragging}
            nudgeWidth={fold.nudgeWidth}
            resetWidth={fold.resetWidth}
            bounds={fold.bounds}
            label="Ширина источников"
          />
        )}
        <SourcesPanel
          spines={spines}
          authors={authors}
          hasLibrary={Boolean(current?.books)}
          onJump={(index) => {
            if (narrow) setSourcesOpen(false);
            jumpToTurn(index);
          }}
          onCollapse={() => setSourcesOpen(false)}
        />
      </aside>

      {/* Затемнение под оверлеями на узком экране — тот же приём, что у
          панели вопросов. */}
      {narrow && (listOpen || sourcesOpen) && (
        <div
          className="absolute inset-0 z-20 bg-black/35 backdrop-blur-sm"
          onClick={() => {
            setListOpen(false);
            setSourcesOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Кнопка вернуть свёрнутую колонку. Стоит на её краю, а не в общей шапке. */
function EdgeButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`absolute top-2.5 z-20 grid h-8 w-8 place-items-center rounded-xl border border-[#dedbd4] bg-[#fbfaf7]/90 text-[#8a827a] shadow-[0_8px_24px_rgba(67,57,45,0.08)] outline-none backdrop-blur-md transition-colors hover:border-[#c5a474] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30 ${
        side === "left" ? "left-2.5" : "right-2.5"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/**
 * Выбор книги — там, где у чат-ботов стоит выбор модели.
 *
 * Это честнее: ученик выбирает не модель, а то, по какой книге отвечать.
 */
function SubjectPicker({
  open,
  onOpenChange,
  subjects,
  selected,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: Subject[];
  selected: string | null;
  onSelect: (goalId: string | null) => void;
}) {
  const current = subjects.find((item) => item.goalId === selected);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="По какой книге отвечать. Смена книги начинает новый разговор"
          className="flex max-w-[11rem] shrink-0 items-center gap-1 self-center rounded-full border border-[#e0dcd4] bg-[#f4f1ea] px-2.5 py-1 text-[11.5px] font-medium text-[#6d665d] outline-none transition-colors hover:border-[#c5a474] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
        >
          <BookOpen className="h-3 w-3 shrink-0 text-[#b98343]" />
          <span className="truncate">{current?.title ?? "Без книги"}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-64 border-[#dcd7cf] bg-[#fbfaf7] p-1 text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f1ede6] ${
            selected === null ? "font-medium text-[#37322c]" : "text-[#4a433b]"
          }`}
        >
          Без книги
          <span className="text-[10px] text-[#a09890]">общий вопрос</span>
        </button>

        <div className="my-1 border-t border-[#e4e0d8]" />

        <div className="max-h-64 overflow-y-auto">
          {subjects.map((subject) => (
            <button
              key={subject.goalId}
              type="button"
              onClick={() => onSelect(subject.goalId)}
              className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f1ede6] ${
                subject.goalId === selected
                  ? "font-medium text-[#37322c]"
                  : "text-[#4a433b]"
              }`}
            >
              <span className="min-w-0 truncate">{subject.title}</span>
              {!subject.books && (
                <span className="shrink-0 text-[10px] text-[#a09890]">
                  без книг
                </span>
              )}
            </button>
          ))}
          {!subjects.length && (
            <p className="px-2.5 py-2 text-[11.5px] text-[#a09890]">
              Предметов пока нет
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
