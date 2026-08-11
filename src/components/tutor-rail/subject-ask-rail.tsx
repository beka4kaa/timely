"use client";

// Панель вопросов по книге. Закреплена справа на всех страницах дашборда.
//
// Оформление — то же, что у чата доски (`board/ai-chat.tsx`): та же тёплая
// палитра, те же размеры пузырей, та же кнопка отправки, тот же ползунок
// сворачивания. Скопирован ВИД, а не код: сам чат — две тысячи строк,
// завязанных на whiteboard-стор и генерацию иллюстраций, и его копия
// разъехалась бы с оригиналом на первой правке.
//
// Чего здесь нет по сравнению с доской: выбора стиля и палитры генерации,
// image-моделей и качества — рисовать панель не умеет и не должна.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveSubject } from "@/contexts/active-subject";
import { useAskRail } from "@/contexts/ask-rail";
import {
  askSubjectStream,
  createChat,
  deleteChat,
  getChat,
  listChats,
  listDocuments,
  listGoals,
  renameChatAutomatically,
  updateChat,
  type AskCitation,
  type AskMessage,
  type CurriculumDocument,
  type LearningGoal,
  type SubjectChatSummary,
} from "@/lib/curriculum-api";
import { ChatTree } from "./chat-tree";
import { bookLabel, citationSpot } from "@/lib/book-label";
import { subjectTitle } from "@/lib/curriculum-catalog";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ThinkingNote, type ThinkingStage } from "@/components/chat/thinking-note";
import "katex/dist/katex.min.css";
import { readSse } from "@/lib/sse";
import { RAIL_WIDTH } from "./dashboard-main";

interface Turn extends AskMessage {
  citations?: AskCitation[];
  /** false — модель ответила от себя: в книге ответа не нашлось. */
  grounded?: boolean;
  error?: string;
  /** Этап, на котором находится ответ. Пусто — работа окончена. */
  stage?: string;
  /** Сколько фрагментов нашлось: попадает в сводку под ответом. */
  found?: number;
  /** Длительность работы, мс. */
  durationMs?: number;
}

// Этапы в порядке прохождения. Больше трёх не бывает намеренно: длинный список
// превращает заметку на полях в чеклист.
const STAGE_ORDER = ["retrieving", "found", "answering"] as const;

function stageLabel(stage: string, found?: number): string {
  if (stage === "retrieving") return "Ищу в книге";
  if (stage === "found") {
    return found ? `Нашёл ${found} ${fragmentWord(found)}` : "В книге не нашлось";
  }
  return "Отвечаю";
}

function fragmentWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "фрагментов";
  if (ones === 1) return "фрагмент";
  if (ones >= 2 && ones <= 4) return "фрагмента";
  return "фрагментов";
}

interface Subject {
  goalId: string;
  title: string;
  books: number;
}

const STORAGE_PREFIX = "timely.ask.";
const LEGACY_TITLE = "Прежний разговор";
// Сколько реплик храним. Панель живёт на всех страницах и открыта неделями —
// без потолка localStorage наберёт мегабайты.
const MAX_STORED_TURNS = 40;

const SUGGESTIONS = ["Объясни проще", "Приведи пример", "С чего начать"];

export function SubjectAskRail() {
  const { open, toggle, isMobile } = useAskRail();
  const { goalId: pageGoalId } = useActiveSubject();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chats, setChats] = useState<SubjectChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Список предметов грузится один раз при первом открытии: на закрытой панели
  // он не нужен, а держать запрос на каждой странице дашборда — расточительно.
  useEffect(() => {
    if (!open || subjects !== null) return;
    let alive = true;
    Promise.all([listGoals(), listDocuments()])
      .then(([goals, documents]) => {
        if (alive) setSubjects(buildSubjects(goals, documents));
      })
      .catch(() => {
        if (alive) setSubjects([]);
      });
    return () => {
      alive = false;
    };
  }, [open, subjects]);

  // Предмет страницы побеждает: если ученик открыл физику, панель спрашивает
  // про физику, а не про то, что он выбирал вчера.
  useEffect(() => {
    if (pageGoalId) setSelected(pageGoalId);
  }, [pageGoalId]);

  useEffect(() => {
    if (selected || !subjects?.length) return;
    const remembered = window.localStorage.getItem(`${STORAGE_PREFIX}subject`);
    const known = subjects.find((item) => item.goalId === remembered);
    setSelected((known ?? subjects[0]).goalId);
  }, [subjects, selected]);

  // Чаты — свои у каждого предмета: вопросы по механике не должны
  // подмешиваться в разговор про машинное обучение.
  useEffect(() => {
    if (!selected) return;
    window.localStorage.setItem(`${STORAGE_PREFIX}subject`, selected);

    let alive = true;
    void (async () => {
      // Разговор, накопленный до появления чатов, переносится в базу, а не
      // стирается молча: ему три дня, но это сообщения ученика.
      await migrateLegacyTurns(selected);
      const rows = await listChats(selected).catch(() => []);
      if (!alive) return;
      setChats(rows);
      const first = rows[0] ?? null;
      setChatId(first?.id ?? null);
      setTurns(first ? await loadChatTurns(first.id) : []);
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [turns]);

  const ask = useCallback(
    async (text?: string) => {
      const question = (text ?? draft).trim();
      if (!question || !selected || busy) return;

      // Обрываем предыдущий поток: два ответа в одну ленту неразличимы.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = turns
        .filter((turn) => !turn.error && turn.content)
        .map(({ role, content }) => ({ role, content }));

      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setBusy(true);
      const startedAt = Date.now();
      setTurns((prev) => [
        ...prev,
        { role: "user", content: question },
        { role: "assistant", content: "", stage: "retrieving" },
      ]);

      const patchLast = (patch: Partial<Turn>) =>
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], ...patch };
          return next;
        });

      try {
        const response = await askSubjectStream(
          { goal_id: selected, message: question, history },
          controller.signal,
        );
        let answer = "";
        for await (const { event, data } of readSse(response)) {
          if (event === "stage") {
            patchLast({
              stage: String(data.stage ?? ""),
              ...(typeof data.found === "number" ? { found: data.found } : {}),
            });
          } else if (event === "content") {
            answer += String(data.delta ?? "");
            patchLast({ content: answer, stage: "answering" });
          } else if (event === "citations") {
            patchLast({
              citations: (data.items as AskCitation[]) ?? [],
              grounded: Boolean(data.grounded),
            });
          } else if (event === "done") {
            patchLast({ stage: "", durationMs: Date.now() - startedAt });
          } else if (event === "error") {
            patchLast({ stage: "", error: String(data.error ?? "Ошибка") });
          }
        }
        if (!answer) {
          patchLast({ stage: "", error: "Пустой ответ." });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          patchLast({
            stage: "",
            error:
              error instanceof Error ? error.message : "Не удалось спросить.",
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    },
    [draft, selected, busy, turns],
  );

  // Сохраняем после завершённого ответа, а не на каждую букву потока: иначе на
  // один вопрос уходит сотня запросов.
  useEffect(() => {
    if (!selected || busy || !turns.length) return;
    let alive = true;
    void (async () => {
      const saved = await persistTurns({ chatId, goalId: selected, turns });
      if (!alive || !saved) return;
      if (saved.id !== chatId) setChatId(saved.id);
      setChats((prev) =>
        prev.some((row) => row.id === saved.id)
          ? prev.map((row) => (row.id === saved.id ? { ...row, ...saved } : row))
          : [saved, ...prev],
      );
    })();
    return () => {
      alive = false;
    };
  }, [selected, turns, busy, chatId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const current = useMemo(
    () => subjects?.find((item) => item.goalId === selected) ?? null,
    [subjects, selected],
  );

  /** Название текущего чата для шапки. Пусто у ещё не сохранённого. */
  const currentChatTitle = useMemo(
    () => chats.find((row) => row.id === chatId)?.title ?? "",
    [chats, chatId],
  );

  /** Чистое состояние. Строка в базе появится с первым вопросом. */
  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setChatId(null);
    setTurns([]);
    setPickerOpen(false);
  }, []);

  const openChat = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setPickerOpen(false);
    setChatId(id);
    setTurns(await loadChatTurns(id));
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      await deleteChat(id).catch(() => undefined);
      setChats((prev) => prev.filter((row) => row.id !== id));
      if (id === chatId) {
        setChatId(null);
        setTurns([]);
      }
    },
    [chatId],
  );

  return (
    <>
      {/* ── Кнопка открытия ─────────────────────────────────────────────── */}
      {/* Только открывает. Свернуть можно из шапки, рядом с «Новым разговором»:
          две кнопки одного назначения в разных углах экрана — это лишний
          поиск глазами. */}
      {!open && (
        <div className="fixed right-4 top-[60px] z-[120]">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Спросить по книге"
                  className="grid h-9 w-9 place-items-center rounded-xl border border-[#dedbd4] bg-[#fbfaf7]/90 text-[#8a827a] shadow-[0_8px_24px_rgba(67,57,45,0.10)] outline-none backdrop-blur-md transition-colors hover:border-[#c5a474] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
                >
                  <PanelRightOpen className="h-[17px] w-[17px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                Спросить по книге
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* ── Затемнение на узком экране ──────────────────────────────────── */}
      {isMobile && open && (
        <div
          className="fixed inset-0 top-12 z-[110] bg-black/40 backdrop-blur-sm"
          onClick={toggle}
        />
      )}

      {/* ── Панель ──────────────────────────────────────────────────────── */}
      <aside
        style={{ width: isMobile ? "100%" : RAIL_WIDTH }}
        className={`fixed bottom-0 right-0 top-12 z-[115] border-l border-[#dedbd4] transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
        // Панель уезжает трансформацией и остаётся в DOM. Без этого её поле
        // ввода ловило бы фокус по Tab со страницы, где панели не видно.
        //
        // Атрибут именно ОТСУТСТВУЕТ, когда панель открыта: `inert` булев по
        // спецификации, и `inert="false"` браузер считает включённым.
        inert={open ? undefined : true}
      >
        <div className="flex h-full min-h-0 flex-col bg-[#f8f6f2] text-[#37322c]">
          <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-[#dedbd4] bg-[#fbfaf7] px-3.5">
            {/* Заголовок «По книге» убран: имя чата само называет, что на
                экране, а книга видна по плашке предмета и подсказке в поле
                ввода. В панели этой ширины освободившиеся ~70 px заметны. */}
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Чаты"
                  className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-[#e0dcd4] bg-[#f4f1ea] px-2.5 py-[3px] text-[11px] font-medium text-[#6d665d] outline-none transition-colors hover:border-[#d3cdc2] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
                >
                  <span className="truncate">
                    {current?.title ?? "Предмет"}
                    {currentChatTitle ? ` › ${currentChatTitle}` : ""}
                  </span>
                  <ChevronDown className="ml-auto h-2.5 w-2.5 shrink-0 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 border-[#dcd7cf] bg-[#fbfaf7] p-0 text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
              >
                <ChatTree
                  subjects={subjects ?? []}
                  chats={chats}
                  selectedGoalId={selected}
                  selectedChatId={chatId}
                  onSelectSubject={setSelected}
                  onSelectChat={(id) => void openChat(id)}
                  onCreate={startNew}
                  onDelete={(id) => void removeChat(id)}
                />
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-0.5 text-[#918b82]">
            <button
              type="button"
              onClick={startNew}
              aria-label="Новый чат"
              title="Новый чат"
              className="grid h-7 w-7 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label="Свернуть панель"
              title="Свернуть панель"
              className="grid h-7 w-7 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
            </div>
          </header>

          <div
            ref={feedRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
          >
            {!turns.length && <EmptyState subject={current} />}
            {turns.map((turn, index) => (
              <TurnView key={index} turn={turn} />
            ))}
          </div>

          {/* ── Подсказки ───────────────────────────────────────────────── */}
          {!!selected && (
            <div className="shrink-0 px-3 pb-1">
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                {SUGGESTIONS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void ask(prompt)}
                    disabled={busy}
                    className="shrink-0 rounded-full border border-[#d9d4cc] bg-[#fbfaf7] px-3 py-1.5 font-serif text-[12px] text-[#7e776e] transition-colors hover:border-[#c5a474] hover:text-[#6f481c] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Ввод ────────────────────────────────────────────────────── */}
          <div
            className="shrink-0 px-3 pt-2"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            {/* Кнопка стоит В ОДНОЙ строке с полем, а не под ним.
                Двухрядная раскладка досталась от чата доски, где нижний ряд
                занимали четыре пилюли генерации. Здесь их нет, и ряд оставался
                пустым — поле ввода выходило вдвое выше нужного. */}
            <div className="flex items-end gap-2 rounded-[17px] border border-[#d8d3cb] bg-[#fbfaf7] px-3 py-2 shadow-[0_8px_24px_rgba(67,57,45,0.06)] transition-[border-color,box-shadow] focus-within:border-[#c79a5b] focus-within:shadow-[0_10px_30px_rgba(138,91,36,0.10)]">
              <textarea
                ref={textareaRef}
                placeholder="Спроси по книге…"
                rows={1}
                value={draft}
                disabled={!selected}
                onChange={(event) => setDraft(event.target.value)}
                onInput={(event) => {
                  // Поле растёт под текст, как в чате доски.
                  const node = event.currentTarget;
                  node.style.height = "auto";
                  node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                className="max-h-[160px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 font-serif text-[14px] leading-relaxed text-[#3b352f] outline-none placeholder:text-[#aaa49b]"
              />
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void ask()}
                      disabled={busy || !draft.trim() || !selected}
                      aria-label="Отправить"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#c9a16c] text-white outline-none transition-colors hover:bg-[#af7d3d] disabled:bg-[#e5dfd6] disabled:text-[#aaa49b]"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowUp className="h-4 w-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Отправить (Enter)
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function EmptyState({ subject }: { subject: Subject | null }) {
  if (subject && !subject.books) {
    return (
      <p className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
        У предмета «{subject.title}» пока нет обработанной книги. Загрузите
        учебник — и можно будет спрашивать по нему.
      </p>
    );
  }
  return (
    <p className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
      Спросите что-нибудь по книге предмета. Ответ придёт со ссылкой на раздел и
      страницу.
    </p>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const isUser = turn.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[94%] whitespace-pre-wrap rounded-[16px] rounded-tr-[5px] bg-[#302d2a] px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#fffdf9]">
          {turn.content}
        </div>
      </div>
    );
  }

  const working = Boolean(turn.stage);
  const stages = buildStages(turn);
  const summary =
    turn.found === undefined
      ? undefined
      : turn.found
        ? `${turn.found} ${fragmentWord(turn.found)}`
        : "в книге не нашлось";

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[94%] flex-col gap-1.5">
        {(working || turn.durationMs) && (
          <ThinkingNote
            stages={stages}
            streaming={working}
            durationMs={turn.durationMs}
            summary={summary}
          />
        )}

        {(turn.content || turn.error) && (
          <div className="rounded-[16px] border border-[#dedad3] bg-white/62 px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#514b43]">
            {turn.error && <span className="text-[#b0473e]">{turn.error}</span>}
            {turn.grounded === false && !!turn.content && (
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
                В книге этого нет
              </div>
            )}
            {turn.content && <MarkdownMessage content={turn.content} />}
          </div>
        )}

        {!!turn.citations?.length && <Citations items={turn.citations} />}
      </div>
    </div>
  );
}

/** Этапы для заметки: пройденные гаснут, текущий остаётся живым. */
function buildStages(turn: Turn): ThinkingStage[] {
  const current = STAGE_ORDER.indexOf(turn.stage as (typeof STAGE_ORDER)[number]);
  if (current < 0) return [];
  return STAGE_ORDER.slice(0, current + 1).map((key, index) => ({
    key,
    label: stageLabel(key, turn.found),
    done: index < current,
  }));
}

/**
 * Ссылки на книгу.
 *
 * Название книги стоит ОДИН раз над списком. Раньше оно повторялось в каждой из
 * восьми ссылок, и вместе с длинным именем файла цитаты занимали больше места,
 * чем сам ответ.
 */
function Citations({ items }: { items: AskCitation[] }) {
  const title = bookLabel(items[0]?.document_title ?? "");
  // Одна книга может дать несколько ссылок на одно место — показываем раз.
  const spots = Array.from(
    new Set(items.map((item) => citationSpot(item)).filter(Boolean)),
  );

  return (
    <div className="px-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#a09890]">
        <BookOpen className="h-3 w-3 shrink-0 text-[#b98343]" />
        <span className="truncate">{title || "Источник"}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {spots.map((spot) => (
          <span
            key={spot}
            className="rounded-full border border-[#e4e0d8] bg-[#fbfaf7] px-2 py-[2px] text-[10.5px] tabular-nums text-[#8a8177]"
          >
            {spot}
          </span>
        ))}
      </div>
    </div>
  );
}

function bookWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "книг";
  if (ones === 1) return "книга";
  if (ones >= 2 && ones <= 4) return "книги";
  return "книг";
}

function buildSubjects(
  goals: LearningGoal[],
  documents: CurriculumDocument[],
): Subject[] {
  const readyByGoal = new Map<string, number>();
  for (const document of documents) {
    if (!document.goal || document.ingestion_status !== "ready") continue;
    readyByGoal.set(document.goal, (readyByGoal.get(document.goal) ?? 0) + 1);
  }
  return goals.map((goal) => ({
    goalId: goal.id,
    title: subjectTitle(goal),
    books: readyByGoal.get(goal.id) ?? 0,
  }));
}

async function loadChatTurns(chatId: string): Promise<Turn[]> {
  try {
    const chat = await getChat(chatId);
    return (chat.messages as Turn[]) ?? [];
  } catch {
    // Чат мог быть удалён с другого устройства — показываем пустой, а не
    // роняем панель.
    return [];
  }
}

/**
 * Пишет разговор в базу. Возвращает строку списка или `null` при отказе.
 *
 * Чат создаётся здесь, а не при нажатии «Новый чат»: иначе список зарастал бы
 * пустыми строками от каждого случайного нажатия.
 */
async function persistTurns({
  chatId,
  goalId,
  turns,
}: {
  chatId: string | null;
  goalId: string;
  turns: Turn[];
}): Promise<SubjectChatSummary | null> {
  const messages = turns.slice(-MAX_STORED_TURNS);
  try {
    if (chatId) {
      const updated = await updateChat(chatId, { messages });
      return { ...updated, message_count: messages.length };
    }
    const created = await createChat(goalId, { messages });
    // Название придумывается после первого ответа и отдельным запросом: внутри
    // потока ученик ждал бы ещё и заголовок, которого не видит.
    const title = await renameChatAutomatically(created.id);
    return {
      ...created,
      title: title || created.title,
      message_count: messages.length,
    };
  } catch {
    // Разговор на экране остаётся; сохранится со следующим ответом.
    return null;
  }
}

/** Переносит разговор, накопленный в браузере до появления чатов. */
async function migrateLegacyTurns(goalId: string): Promise<void> {
  const key = `${STORAGE_PREFIX}${goalId}`;
  const raw = window.localStorage.getItem(key);
  if (!raw) return;
  // Ключ убирается в любом случае: повторный перенос создал бы дубли.
  window.localStorage.removeItem(key);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return;
    await createChat(goalId, {
      title: LEGACY_TITLE,
      messages: parsed.slice(-MAX_STORED_TURNS),
    });
  } catch {
    // Испорченная запись переносу не подлежит.
  }
}
