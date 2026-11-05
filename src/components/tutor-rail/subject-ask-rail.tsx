"use client";

// Вопросы в мини-окне внизу: быстрый запрос, короткий ответ и дело.
//
// Здесь только раскладка. Сам разговор (поток ответа, история, сохранение) живёт в
// `chat/use-subject-chat.ts`, тот же движок ведёт страницу «Чат». Разница в том, что окно
// показывает один последний ответ, а продолжить разговор можно уже в чате.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { askErrorText, stageLabel } from "@/components/chat/ask-stages";
import { usageLine } from "@/components/chat/chat-usage";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { useSubjectChat, type Turn } from "@/components/chat/use-subject-chat";
import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { QuickComposer } from "@/components/shell/quick/quick-composer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dashboardViewOf, type DashboardView } from "@/config/dashboard-navigation";
import { isScheduleRailRoute } from "@/config/schedule-rail-routes";
import { useActiveSubject } from "@/contexts/active-subject";
import { useAskRail } from "@/contexts/ask-rail";
import { bookLabel, citationSpot } from "@/lib/book-label";
import { useChatPrefs } from "@/lib/chat-prefs";
import {
  listDocuments,
  listGoals,
  type CurriculumDocument,
  type LearningGoal,
} from "@/lib/curriculum-api";
import { subjectTitle } from "@/lib/curriculum-catalog";
import {
  RECORD_EVENT,
  recordTarget,
  understandLocally,
  type Understood,
  type UnderstoodKind,
} from "@/lib/understand";
import { useDashboardPath } from "@/lib/use-dashboard-path";
import "katex/dist/katex.min.css";
import { RailShell } from "./rail-shell";
import { ScheduleRail } from "./schedule-rail";

interface Subject {
  goalId: string;
  title: string;
  books: number;
}

/** Предмет, выбранный в прошлый раз. Тот же ключ, что у страницы чата. */
const SUBJECT_KEY = "timely.ask.subject";
/** Значение ключа для разговора без книги. */
const NO_BOOK = "none";

const SUGGESTIONS: Partial<Record<DashboardView, string[]>> = {
  now: ["С чего начать?", "Разбей это на шаги", "Объясни проще"],
  diary: ["Как распределить домашку на вечер?"],
  focus: ["Как не отвлекаться?"],
  library: ["С чего начать?"],
  course: ["Объясни проще", "Приведи пример"],
};

/** Что человек, скорее всего, вводит на этой странице: запись, а не вопрос. */
const EXPECT: Partial<Record<DashboardView, UnderstoodKind>> = {
  weak: "topics",
  goals: "goal",
  habits: "habit",
};

export function SubjectAskRail() {
  // На странице «Чат» окна нет: чат внутри чата бессмыслен. На «Плане» разговор про
  // календарь, а не про учебник: у режимов разное состояние и разные запросы.
  const { hidden } = useAskRail();
  const schedule = isScheduleRailRoute(useDashboardPath());
  if (hidden) return null;
  return schedule ? <ScheduleRail /> : <AskRail />;
}

function AskRail() {
  const { open, toggle, pending, consumePrompt } = useAskRail();
  const { goalId: pageGoalId } = useActiveSubject();
  const path = useDashboardPath();
  const view = dashboardViewOf(path);
  const router = useRouter();
  /** Написали не вопрос, а цель, привычку или то, что изучил. Здесь только разбор правилами. */
  const [record, setRecord] = useState<{ text: string; found: Understood } | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  /** `null` — без книги: тьютор отвечает от себя и источников не показывает. */
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Текст, подставленный в поле извне. `nonce` пересоздаёт поле с этим черновиком. */
  const [draft, setDraft] = useState<{ text: string; nonce: number } | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const chat = useSubjectChat({
    goalId: selected,
    enabled: open,
    migrateLegacy: true,
  });

  // Список предметов грузится при первом открытии: на каждой странице он не нужен.
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

  // Предмет страницы побеждает: открыл физику, значит и спрашиваешь про физику. Но идущий
  // разговор не перебиваем: смена предмета сбросила бы вопрос вместе с ответом. Принятый
  // предмет помнится, иначе ручной выбор тут же отменялся бы предметом страницы.
  const conversationActive = chat.busy || chat.turns.length > 0;
  const adoptedPageGoal = useRef<string | null>(null);
  useEffect(() => {
    if (!pageGoalId) {
      adoptedPageGoal.current = null;
      return;
    }
    if (conversationActive || adoptedPageGoal.current === pageGoalId) return;
    adoptedPageGoal.current = pageGoalId;
    setSelected(pageGoalId);
  }, [pageGoalId, conversationActive]);

  useEffect(() => {
    if (pageGoalId || !subjects?.length) return;
    const remembered = window.localStorage.getItem(SUBJECT_KEY);
    if (remembered === NO_BOOK) return;
    if (subjects.some((item) => item.goalId === remembered)) setSelected(remembered);
    // Только при загрузке списка: дальше выбор делает сам ученик.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects]);

  const pick = (goalId: string | null) => {
    setPickerOpen(false);
    if (goalId === selected) return;
    setSelected(goalId);
    window.localStorage.setItem(SUBJECT_KEY, goalId ?? NO_BOOK);
    // Книга у разговора одна: смена книги начинает новый разговор.
    if (chat.turns.length) chat.startNew();
  };

  // Просьба извне: «Нужна помощь» на карточке, вопрос с главной. Сначала выбирается
  // предмет, и только следующим проходом разговор: смена предмета сбрасывает ленту.
  useEffect(() => {
    if (!pending || pending.target !== "book" || !open) return;
    const wanted = pending.goalId ?? null;
    if (wanted && wanted !== selected) {
      setSelected(wanted);
      return;
    }
    if (pending.chatId) {
      void chat.openChat(pending.chatId);
    } else if (pending.text && pending.send) {
      // Идущий ответ дорисуется, а вопрос уйдёт следом.
      if (chat.busy) return;
      // Новый вопрос, новый разговор: смешивать две темы в одной ленте незачем.
      chat.startNew();
      void chat.ask(pending.text, []);
    } else if (pending.text) {
      setDraft({ text: pending.text, nonce: pending.id });
    }
    consumePrompt(pending.id);
  }, [pending, open, selected, chat, consumePrompt]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [chat.turns]);

  // Слайм думает над запросом, даже если окно уже закрыли.
  const last = chat.turns[chat.turns.length - 1];
  const stage = last?.role === "assistant" ? last.stage ?? "" : "";
  const thinking = useRef(false);
  const { busy, stop, turns } = chat;
  useEffect(() => {
    if (busy && !thinking.current) {
      thinking.current = true;
      const question = [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "Вопрос";
      mascot.thinkStart(question, () => {
        thinking.current = false;
        stop();
      });
    } else if (!busy && thinking.current) {
      thinking.current = false;
      const failed = turns[turns.length - 1]?.error;
      mascot.thinkEnd(failed ? undefined : "Готово");
    }
  }, [busy, turns, stop]);
  useEffect(() => {
    if (thinking.current && stage) mascot.thought(stageLabel(stage, last?.found));
  }, [stage, last?.found]);

  const current = useMemo(
    () => subjects?.find((item) => item.goalId === selected) ?? null,
    [subjects, selected],
  );

  const submit = (text: string) => {
    const found = understandLocally(text, EXPECT[view]);
    if (found.kind === "question") {
      setRecord(null);
      void chat.ask(text);
    } else {
      setRecord({ text, found });
    }
  };

  const saveRecord = () => {
    if (!record) return;
    const target = recordTarget(record.found.kind, record.text);
    setRecord(null);
    toggle();
    if (!target) return;
    // Страница уже открыта: адрес не изменится и она ничего не заметит, поэтому говорим ей прямо.
    if (target.path === path) window.dispatchEvent(new CustomEvent(RECORD_EVENT, { detail: record.text }));
    else router.push(target.href);
  };

  const picker = (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <PopoverTrigger asChild>
        <button className="q-tool" type="button" title="По какой книге отвечать">
          <Icon name="book" />
          <span>{current?.title ?? "Без книги"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-0">
        <div className="q-book-menu">
          <button type="button" aria-pressed={selected === null} onClick={() => pick(null)}>
            Без книги
          </button>
          {subjects?.map((subject) => (
            <button
              key={subject.goalId}
              type="button"
              aria-pressed={subject.goalId === selected}
              onClick={() => pick(subject.goalId)}
            >
              <span>{subject.title}</span>
              {subject.books ? null : <small>нет книги</small>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <RailShell
      mode="book"
      edgeLabel="Быстрый запрос"
      footer={
        <QuickComposer
          key={draft?.nonce ?? "composer"}
          initialDraft={draft?.text}
          onSubmit={submit}
          onStop={chat.stop}
          busy={chat.busy}
          placeholder={current ? "Спроси по книге" : "Чем помочь?"}
          suggestions={chat.turns.length || record ? undefined : SUGGESTIONS[view]}
          left={picker}
        />
      }
      feedRef={feedRef}
    >
      {record ? (
        <RecordOffer
          found={record.found}
          onSave={saveRecord}
          onAsk={() => {
            const { text } = record;
            setRecord(null);
            void chat.ask(text);
          }}
          onDismiss={() => setRecord(null)}
        />
      ) : chat.turns.length ? (
        <LastAnswer turns={chat.turns} chatId={chat.chatId} onNew={chat.startNew} />
      ) : null}
    </RailShell>
  );
}

/**
 * Запись вместо вопроса. Само окно ничего не сохраняет: у страницы цели, привычки или темы
 * есть предпросмотр, выбор предмета и отмена, и второй такой же набор здесь разъехался бы.
 */
function RecordOffer({
  found,
  onSave,
  onAsk,
  onDismiss,
}: {
  found: Understood;
  onSave: () => void;
  onAsk: () => void;
  onDismiss: () => void;
}) {
  const rows =
    found.kind === "topics"
      ? found.topics.map((topic) => ({ name: topic.title, note: topic.subject }))
      : found.kind === "habit"
        ? [{ name: found.name, note: "каждый день" }]
        : found.kind === "goal"
          ? [{ name: found.title, note: found.scope === "study" ? "учёба" : "общая" }]
          : [];
  const say =
    found.kind === "topics"
      ? "Запишу в повторение, первое завтра:"
      : found.kind === "habit"
        ? "Это привычка:"
        : "Это цель:";
  const target = recordTarget(found.kind, "");
  return (
    <div>
      <p className="q-say">{say}</p>
      <ul className="q-diff">
        {rows.map((row) => (
          <li key={row.name}>
            <span className="nm">{row.name}</span>
            <span className="chg">{row.note}</span>
          </li>
        ))}
      </ul>
      <div className="q-acts">
        <button className="btn btn-main" type="button" onClick={onSave}>
          {target?.label ?? "Записать"}
        </button>
        <button className="btn btn-text" type="button" onClick={onAsk}>
          Это вопрос
        </button>
        <button className="btn btn-text" type="button" onClick={onDismiss}>
          Не надо
        </button>
      </div>
    </div>
  );
}

/** Один последний ответ: окно для быстрого дела, а весь разговор в чате. */
function LastAnswer({
  turns,
  chatId,
  onNew,
}: {
  turns: Turn[];
  chatId: string | null;
  onNew: () => void;
}) {
  const { showUsage } = useChatPrefs();
  const answer = turns[turns.length - 1];
  const question = turns[turns.length - 2];
  if (!answer) return null;
  const working = Boolean(answer.stage);
  const spots = Array.from(new Set((answer.citations ?? []).map((item) => citationSpot(item)).filter(Boolean)));
  return (
    <>
      {question?.role === "user" ? <p className="q-q">{question.content}</p> : null}
      {working && !answer.content ? (
        <p className="q-status shine">{stageLabel(answer.stage ?? "", answer.found)}</p>
      ) : null}
      {answer.error ? <p className="q-status">{askErrorText(answer.error)}</p> : null}
      {answer.content ? (
        <div className="q-say">
          <MarkdownMessage content={answer.content} variant="rail" />
        </div>
      ) : null}
      {showUsage && answer.usage ? <p className="q-cite">{usageLine(answer.usage)}</p> : null}
      {spots.length ? (
        <p className="q-cite">
          {bookLabel(answer.citations?.[0]?.document_title ?? "")}: {spots.join(", ")}
        </p>
      ) : null}
      {!working ? (
        <div className="q-more">
          {chatId ? (
            <Link className="btn btn-line" href={`/dashboard/chat?chat=${chatId}`}>
              Открыть в чате
            </Link>
          ) : null}
          <button className="btn btn-text" type="button" onClick={onNew}>
            Новый вопрос
          </button>
        </div>
      ) : null}
    </>
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
