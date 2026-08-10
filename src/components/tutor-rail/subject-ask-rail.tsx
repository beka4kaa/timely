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
  X,
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
  listDocuments,
  listGoals,
  type AskCitation,
  type AskMessage,
  type CurriculumDocument,
  type LearningGoal,
} from "@/lib/curriculum-api";
import { subjectTitle } from "@/lib/curriculum-catalog";
import { readSse } from "@/lib/sse";

interface Turn extends AskMessage {
  citations?: AskCitation[];
  /** false — модель ответила от себя: в книге ответа не нашлось. */
  grounded?: boolean;
  pending?: boolean;
  error?: string;
}

interface Subject {
  goalId: string;
  title: string;
  books: number;
}

const STORAGE_PREFIX = "timely.ask.";
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

  // История — своя у каждого предмета: вопросы по механике не должны
  // подмешиваться в разговор про машинное обучение.
  useEffect(() => {
    if (!selected) return;
    window.localStorage.setItem(`${STORAGE_PREFIX}subject`, selected);
    setTurns(loadTurns(selected));
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
      setTurns((prev) => [
        ...prev,
        { role: "user", content: question },
        { role: "assistant", content: "", pending: true },
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
          if (event === "content") {
            answer += String(data.delta ?? "");
            patchLast({ content: answer, pending: false });
          } else if (event === "citations") {
            patchLast({
              citations: (data.items as AskCitation[]) ?? [],
              grounded: Boolean(data.grounded),
            });
          } else if (event === "error") {
            patchLast({ pending: false, error: String(data.error ?? "Ошибка") });
          }
        }
        if (!answer) patchLast({ pending: false, error: "Пустой ответ." });
      } catch (error) {
        if (!controller.signal.aborted) {
          patchLast({
            pending: false,
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

  // Сохраняем после каждого изменения ленты, а не только по завершении: ученик
  // может уйти со страницы посреди ответа.
  useEffect(() => {
    if (!selected || busy) return;
    storeTurns(selected, turns);
  }, [selected, turns, busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const current = useMemo(
    () => subjects?.find((item) => item.goalId === selected) ?? null,
    [subjects, selected],
  );

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    if (selected) storeTurns(selected, []);
  }, [selected]);

  return (
    <>
      {/* ── Ползунок сворачивания ───────────────────────────────────────── */}
      {/* На узком экране открытая панель занимает экран целиком, и кнопка
          легла бы на её шапку — там закрывает крестик внутри панели. */}
      <div
        hidden={isMobile && open}
        className="fixed top-[60px] z-[120] transition-[right] duration-300 ease-in-out"
        style={{ right: open && !isMobile ? "calc(25% + 16px)" : 16 }}
      >
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-label={open ? "Скрыть панель" : "Спросить по книге"}
                className="grid h-10 w-10 place-items-center rounded-xl border border-[#dedbd4] bg-[#fbfaf7]/90 text-[#8a827a] shadow-[0_8px_24px_rgba(67,57,45,0.10)] outline-none backdrop-blur-md transition-all hover:border-[#c5a474] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
              >
                {open ? (
                  <PanelRightClose className="h-[18px] w-[18px]" />
                ) : (
                  <PanelRightOpen className="h-[18px] w-[18px]" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              {open ? "Скрыть панель" : "Спросить по книге"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* ── Затемнение на узком экране ──────────────────────────────────── */}
      {isMobile && open && (
        <div
          className="fixed inset-0 top-12 z-[110] bg-black/40 backdrop-blur-sm"
          onClick={toggle}
        />
      )}

      {/* ── Панель ──────────────────────────────────────────────────────── */}
      <aside
        className={`fixed bottom-0 right-0 top-12 z-[115] w-full min-w-[280px] border-l border-[#dedbd4] transition-transform duration-300 ease-in-out md:w-[25%] ${
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
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="shrink-0 font-serif text-[14px] font-semibold tracking-[-0.015em] text-[#37322c]">
                По книге
              </h2>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title="Предмет"
                    className="flex min-w-0 items-center gap-1 rounded-full border border-[#e0dcd4] bg-[#f4f1ea] px-2 py-[3px] text-[10px] font-medium text-[#6d665d] outline-none transition-colors hover:border-[#d3cdc2] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
                  >
                    <span className="truncate">
                      {current?.title ?? "Предмет"}
                    </span>
                    <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-60" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-64 border-[#dcd7cf] bg-[#fbfaf7] p-0 text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
                >
                  <div className="border-b border-[#e4e0d8] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
                    Предмет
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {!subjects?.length && (
                      <div className="px-3 py-4 text-[12px] text-[#8f887f]">
                        Предметов пока нет
                      </div>
                    )}
                    {(subjects ?? []).map((subject) => (
                      <button
                        key={subject.goalId}
                        type="button"
                        onClick={() => {
                          setSelected(subject.goalId);
                          setPickerOpen(false);
                        }}
                        className={`block w-full px-3 py-2 text-left transition-colors hover:bg-[#f1ede6] ${
                          subject.goalId === selected ? "bg-[#f4f0e9]" : ""
                        }`}
                      >
                        <div className="truncate text-[12px] font-medium text-[#37322c]">
                          {subject.title}
                        </div>
                        <div className="mt-0.5 text-[10px] leading-snug text-[#8f887f]">
                          {subject.books
                            ? `${subject.books} ${bookWord(subject.books)}`
                            : "книг пока нет"}
                        </div>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-0.5">
            {isMobile && (
              <button
                type="button"
                onClick={toggle}
                aria-label="Закрыть"
                title="Закрыть"
                className="grid h-7 w-7 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={startNew}
              aria-label="Новый разговор"
              title="Новый разговор"
              className="grid h-7 w-7 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
            >
              <Plus className="h-3.5 w-3.5" />
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
            <div className="flex flex-col rounded-[17px] border border-[#d8d3cb] bg-[#fbfaf7] px-3 pb-2 pt-3 shadow-[0_8px_24px_rgba(67,57,45,0.06)] transition-[border-color,box-shadow] focus-within:border-[#c79a5b] focus-within:shadow-[0_10px_30px_rgba(138,91,36,0.10)]">
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
                className="mb-2 max-h-[160px] min-h-[30px] w-full resize-none bg-transparent px-1 font-serif text-[14px] leading-relaxed text-[#3b352f] outline-none placeholder:text-[#aaa49b]"
              />
              <div className="flex items-center">
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => void ask()}
                          disabled={busy || !draft.trim() || !selected}
                          aria-label="Отправить"
                          className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-[#c9a16c] text-white outline-none transition-colors hover:bg-[#af7d3d] disabled:bg-[#e5dfd6] disabled:text-[#aaa49b]"
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

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="flex max-w-[94%] flex-col gap-1.5">
        <div
          className={`flex flex-col gap-2 whitespace-pre-wrap px-3.5 py-2.5 text-[13px] leading-[1.55] ${
            isUser
              ? "rounded-[16px] rounded-tr-[5px] bg-[#302d2a] text-[#fffdf9]"
              : "rounded-[16px] border border-[#dedad3] bg-white/62 text-[#514b43]"
          }`}
        >
          {turn.pending && (
            <span className="flex items-center gap-2 text-[12px] text-[#8f887f]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ищу в книге…
            </span>
          )}
          {turn.error && <span className="text-[#b0473e]">{turn.error}</span>}
          {turn.grounded === false && !!turn.content && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
              В книге этого нет
            </span>
          )}
          {turn.content}
        </div>

        {!!turn.citations?.length && (
          <ul className="space-y-1 px-1">
            {turn.citations.map((citation, index) => (
              <li
                key={index}
                className="flex items-start gap-1.5 text-[10px] leading-4 text-[#8e877e]"
              >
                <BookOpen className="mt-0.5 h-3 w-3 shrink-0 text-[#b98343]" />
                {citation.label}
              </li>
            ))}
          </ul>
        )}
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

function loadTurns(goalId: string): Turn[] {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${goalId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Испорченная запись не должна ломать панель — начинаем разговор заново.
    return [];
  }
}

function storeTurns(goalId: string, turns: Turn[]) {
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${goalId}`,
      JSON.stringify(turns.slice(-MAX_STORED_TURNS)),
    );
  } catch {
    // Квота исчерпана — история не сохранится, но разговор продолжается.
  }
}
