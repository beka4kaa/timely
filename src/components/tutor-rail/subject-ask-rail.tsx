"use client";

// Панель вопросов по книге. Закреплена справа на всех страницах дашборда.
//
// Почему не копия чата доски: `board/ai-chat.tsx` — это две тысячи строк,
// завязанных на whiteboard-стор, генерацию иллюстраций и выбор image-моделей.
// Здесь нужен разговор по книге, и всё перечисленное было бы мёртвым грузом,
// который к тому же разъехался бы с оригиналом на первой правке.
//
// Панель — ОВЕРЛЕЙ, а не колонка: `main` в layout'е дашборда не переверстывается,
// иначе каждая страница получила бы новую ширину и поехала вёрстка.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BookOpen, Loader2, MessageSquare, X } from "lucide-react";

import { useActiveSubject } from "@/contexts/active-subject";
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
import {
  paperCaption,
  paperFocus,
  paperTile,
} from "@/components/curriculum/paper";

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
const OPEN_KEY = "timely.ask.open";
// Сколько реплик храним. Панель живёт на всех страницах и открыта неделями —
// без потолка localStorage наберёт мегабайты.
const MAX_STORED_TURNS = 40;

export function SubjectAskRail() {
  const { goalId: pageGoalId } = useActiveSubject();
  const [open, setOpen] = useState(false);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(window.localStorage.getItem(OPEN_KEY) === "1");
  }, []);

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

  const toggle = useCallback(() => {
    setOpen((prev) => {
      window.localStorage.setItem(OPEN_KEY, prev ? "0" : "1");
      return !prev;
    });
  }, []);

  const ask = useCallback(async () => {
    const question = draft.trim();
    if (!question || !selected || busy) return;

    // Обрываем предыдущий поток: два ответа в одну ленту неразличимы.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const history = turns
      .filter((turn) => !turn.error && turn.content)
      .map(({ role, content }) => ({ role, content }));

    setDraft("");
    setBusy(true);
    setTurns((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "", pending: true },
    ]);

    const patchLast = (patch: Partial<Turn>) =>
      setTurns((prev) => {
        const next = [...prev];
        const last = next.length - 1;
        next[last] = { ...next[last], ...patch };
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
          error: error instanceof Error ? error.message : "Не удалось спросить.",
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [draft, selected, busy, turns]);

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

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Спросить по книге"
        className={`fixed bottom-6 right-4 z-[110] flex h-11 w-11 items-center justify-center rounded-full border border-[#d8d1c7] bg-[#fffdfa] text-[#6b6259] shadow-[0_8px_24px_rgba(70,54,36,0.14)] transition-colors hover:border-[#c7aa82] hover:text-[#312c27] ${paperFocus}`}
      >
        <MessageSquare className="h-5 w-5" />
      </button>
    );
  }

  return (
    <aside className="fixed bottom-0 right-0 top-12 z-[110] flex w-full flex-col border-l border-[#ddd7cd] bg-[#fbfaf7] shadow-[-12px_0_40px_rgba(70,54,36,0.08)] sm:w-[380px]">
      <header className="flex items-center gap-2 border-b border-[#e7e1d7] px-4 py-3">
        <select
          value={selected ?? ""}
          onChange={(event) => setSelected(event.target.value)}
          aria-label="Предмет"
          className={`${paperFocus} min-w-0 flex-1 truncate rounded-full border border-[#ddd7cd] bg-[#fffdfa] px-3 py-1.5 text-[13px] text-[#3c3730]`}
        >
          {(subjects ?? []).map((subject) => (
            <option key={subject.goalId} value={subject.goalId}>
              {subject.title}
              {subject.books ? "" : " — без книг"}
            </option>
          ))}
          {!subjects?.length && <option value="">Предметов пока нет</option>}
        </select>
        <button
          type="button"
          onClick={toggle}
          aria-label="Свернуть"
          className={`${paperFocus} rounded-full p-1.5 text-[#9b9186] transition-colors hover:text-[#312c27]`}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={feedRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!turns.length && <EmptyState subject={current} />}
        {turns.map((turn, index) => (
          <TurnView key={index} turn={turn} />
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
        className="border-t border-[#e7e1d7] p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter отправляет, Shift+Enter переносит строку — как в чате
              // доски: ученик уже привык.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
            rows={2}
            placeholder="Спросить по книге…"
            disabled={!selected}
            className={`${paperFocus} min-h-[44px] flex-1 resize-none rounded-[14px] border border-[#ddd7cd] bg-[#fffdfa] px-3 py-2 text-[13px] leading-5 text-[#3c3730] placeholder:text-[#a9a096] disabled:opacity-60`}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim() || !selected}
            aria-label="Отправить"
            className={`${paperFocus} flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#8a5b24] bg-[#8a5b24] text-[#fdf8ef] transition-colors hover:bg-[#754a19] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </aside>
  );
}

function EmptyState({ subject }: { subject: Subject | null }) {
  if (subject && !subject.books) {
    return (
      <p className="px-1 text-[13px] leading-5 text-[#7f776e]">
        У предмета «{subject.title}» пока нет обработанной книги. Загрузите
        учебник — и можно будет спрашивать по нему.
      </p>
    );
  }
  return (
    <p className="px-1 text-[13px] leading-5 text-[#7f776e]">
      Спросите что-нибудь по книге предмета. Ответ придёт со ссылкой на раздел и
      страницу.
    </p>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[14px] bg-[#f0e9dd] px-3 py-2 text-[13px] leading-5 text-[#3c3730]">
          {turn.content}
        </p>
      </div>
    );
  }

  return (
    <div className={`${paperTile} px-3 py-2.5`}>
      {turn.pending && (
        <span className="flex items-center gap-2 text-[12px] text-[#9b9186]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ищу в книге…
        </span>
      )}
      {turn.error && (
        <p className="text-[13px] leading-5 text-[#a05a3c]">{turn.error}</p>
      )}
      {turn.content && (
        <>
          {turn.grounded === false && (
            <p className={`${paperCaption} mb-1.5`}>В книге этого нет</p>
          )}
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-[#3c3730]">
            {turn.content}
          </p>
        </>
      )}
      {!!turn.citations?.length && (
        <ul className="mt-2 space-y-1 border-t border-[#e7e1d7] pt-2">
          {turn.citations.map((citation, index) => (
            <li
              key={index}
              className="flex items-start gap-1.5 text-[11px] leading-4 text-[#8a8077]"
            >
              <BookOpen className="mt-0.5 h-3 w-3 shrink-0" />
              {citation.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
