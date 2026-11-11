"use client";

// Вопросы в мини-окне внизу: быстрый запрос, короткий ответ и дело.
//
// Здесь только раскладка. Сам разговор (поток ответа, история, сохранение) живёт в
// `chat/use-subject-chat.ts`, тот же движок ведёт страницу «Чат». Разница в том, что окно
// показывает один последний ответ, а продолжить разговор можно уже в чате.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { answerPreview } from "@/components/chat/answer-preview";
import { askErrorText, STOPPED_ERROR, turnStage } from "@/components/chat/ask-stages";
import { proposalSummary } from "@/components/chat/assistant-proposal";
import { AssistantProposals, type ProposalChange } from "@/components/chat/assistant-proposals";
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
import { BOOKS_ENABLED } from "@/config/features";
import { railPlaceholder, showBookPicker } from "@/lib/curriculum-books";
import { subjectTitle } from "@/lib/curriculum-catalog";
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
  now: ["Что у меня сегодня?", "С чего начать?", "Разбей это на шаги"],
  diary: ["Что задали на завтра?", "Как распределить домашку на вечер?"],
  focus: ["Сколько я занимался на неделе?", "Как не отвлекаться?"],
  weak: ["Что пора повторить?"],
  goals: ["Какая цель ближе всего по сроку?"],
  habits: ["Что я сегодня не отметил?"],
  library: ["С чего начать?"],
  course: ["Объясни проще", "Приведи пример"],
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
  const { open, openRail, pending, consumePrompt } = useAskRail();
  const { goalId: pageGoalId } = useActiveSubject();
  const view = dashboardViewOf(useDashboardPath());
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  /** Книга из прошлого раза уже выбрана: теперь вопрос можно отправлять. */
  const [bookSettled, setBookSettled] = useState(false);
  /** Ответ пришёл, пока окно было закрыто, и его ещё не открывали. */
  const [unseen, setUnseen] = useState(false);
  /** `null` — без книги: тьютор отвечает от себя и источников не показывает. */
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Текст, подставленный в поле извне. `nonce` пересоздаёт поле с этим черновиком. */
  const [draft, setDraft] = useState<{ text: string; nonce: number } | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const chat = useSubjectChat({
    goalId: selected,
    enabled: open,
    page: view,
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

  // Книга из прошлого раза выбирается сразу при открытии, а не когда загрузится список. Смена
  // книги начинает новый разговор: вопрос, заданный раньше, она обрывала, и ученик видел только,
  // что слайм подумал и замолчал. Просьба со страницы ждёт этого шага.
  useEffect(() => {
    if (!open || bookSettled) return;
    setBookSettled(true);
    if (pageGoalId) return;
    const remembered = window.localStorage.getItem(SUBJECT_KEY);
    if (BOOKS_ENABLED && remembered && remembered !== NO_BOOK) setSelected(remembered);
  }, [open, bookSettled, pageGoalId]);

  // Книгу могли удалить, пока ученика не было. Идущий разговор не трогаем.
  useEffect(() => {
    if (!subjects?.length || !selected || conversationActive) return;
    if (!subjects.some((item) => item.goalId === selected)) setSelected(null);
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
    if (!pending || pending.target !== "book" || !open || !bookSettled) return;
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
  }, [pending, open, bookSettled, selected, chat, consumePrompt]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [chat.turns]);

  // Слайм думает над запросом, даже если окно уже закрыли. Закрыли: готовый ответ он показывает
  // прямо в плашке, иначе ученик увидел бы только, что слайм подумал и замолчал.
  const last = chat.turns[chat.turns.length - 1];
  const stage = last?.role === "assistant" ? last.stage ?? "" : "";
  const thinking = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const { busy, stop, turns } = chat;
  const lastQuestion = [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "Вопрос";
  useEffect(() => {
    if (busy && !thinking.current) {
      thinking.current = true;
      mascot.thinkStart(lastQuestion, () => {
        thinking.current = false;
        stop();
      });
    } else if (!busy && thinking.current) {
      thinking.current = false;
      const answer = turns[turns.length - 1];
      const proposals = (answer?.proposals ?? []).filter((item) => !item.state);
      if (openRef.current) {
        mascot.thinkEnd(answer?.error ? undefined : proposals.length ? "Есть вариант" : "Готово");
        return;
      }
      mascot.thinkEnd();
      const text = readyText(answer);
      if (!text) return;
      mascot.remind(lastQuestion, text, openRail, { stay: true, long: true });
      setUnseen(true);
    }
  }, [busy, turns, stop, lastQuestion, openRail]);
  useEffect(() => {
    if (thinking.current && stage) mascot.thought(last ? turnStage(last) : "");
  }, [stage, last?.found, last?.toolLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Страница, где окна нет: разговор обрывается, и плашка не должна думать вечно.
  useEffect(
    () => () => {
      if (thinking.current) mascot.thinkEnd();
      thinking.current = false;
    },
    [],
  );

  // Открыли окно: ответ на месте, напоминать больше не о чем. Начинаем с его начала, а если
  // ждёт решение, с кнопок.
  useEffect(() => {
    if (!open || !unseen) return;
    setUnseen(false);
    mascot.remindOff();
    const toButtons = Boolean(last?.proposals?.some((item) => !item.state));
    window.requestAnimationFrame(() => {
      const feed = feedRef.current;
      feed?.scrollTo({ top: toButtons ? feed.scrollHeight : 0 });
    });
  }, [open, unseen, last]);

  const current = useMemo(
    () => subjects?.find((item) => item.goalId === selected) ?? null,
    [subjects, selected],
  );

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
          onSubmit={(text) => void chat.ask(text)}
          onStop={chat.stop}
          busy={chat.busy}
          placeholder={railPlaceholder(BOOKS_ENABLED, Boolean(current))}
          suggestions={chat.turns.length ? undefined : SUGGESTIONS[view]}
          left={showBookPicker(BOOKS_ENABLED) ? picker : undefined}
        />
      }
      feedRef={feedRef}
      unseen={unseen}
    >
      {chat.turns.length ? (
        <LastAnswer
          turns={chat.turns}
          chatId={chat.chatId}
          onNew={chat.startNew}
          onProposal={chat.updateProposal}
        />
      ) : null}
    </RailShell>
  );
}

/** Что сказать в плашке, если окно закрыто. Пусто: сказать нечего, ученик сам остановил ответ. */
function readyText(answer: Turn | undefined): string {
  if (!answer || answer.error === STOPPED_ERROR) return "";
  if (answer.error) return askErrorText(answer.error);
  const waiting = (answer.proposals ?? []).filter((item) => !item.state);
  if (waiting.length) return `Предлагаю: ${waiting.map(proposalSummary).join("; ")}. Открой, чтобы применить.`;
  return answerPreview(answer.content);
}

/** Один последний ответ: окно для быстрого дела, а весь разговор в чате. */
function LastAnswer({
  turns,
  chatId,
  onNew,
  onProposal,
}: {
  turns: Turn[];
  chatId: string | null;
  onNew: () => void;
  onProposal: ProposalChange;
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
        <p className="q-status shine">{turnStage(answer)}</p>
      ) : null}
      {answer.error ? <p className="q-status">{askErrorText(answer.error)}</p> : null}
      {answer.content ? (
        <div className="q-say">
          <MarkdownMessage content={answer.content} variant="rail" />
        </div>
      ) : null}
      <AssistantProposals proposals={answer.proposals} onChange={onProposal} />
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
