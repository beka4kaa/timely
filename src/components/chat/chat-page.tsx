"use client";

// Страница «Чат»: разговор с тьютором.
//
// Список разговоров живёт в левой панели (порталом: движок у этой страницы), посередине
// переписка и плавающее поле, справа источники, если у разговора есть книга. На телефоне
// панели нет, и тот же список открывается нижним листом.
//
// Разговор ведёт тот же движок, что и мини-окно (`use-subject-chat`). Здесь раскладка,
// режимы и всё, что связывает разговор с остальным приложением: адрес, слайм, план.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/shell/icons";
import { SubNav } from "@/components/shell/tab-bar";
import { useAskRail } from "@/contexts/ask-rail";
import { useDashboardShell } from "@/contexts/dashboard-shell";
import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";
import type { FolderSubject } from "@/lib/chat-folders";
import { buildSpines } from "@/lib/citation-spread";
import {
  fetchAskOptions,
  listDocuments,
  listGoals,
  type CurriculumDocument,
  type LearningGoal,
} from "@/lib/curriculum-api";
import { subjectTitle } from "@/lib/curriculum-catalog";
import { coverAuthor, coverTitle } from "@/lib/curriculum-cover";
import { isTerminal } from "@/lib/curriculum-progress";
import { setChatPrefs, useChatPrefs } from "@/lib/chat-prefs";
import { invalidateResources, useResource, type ResourceState } from "@/lib/resource-cache";

import { STOPPED_ERROR } from "./ask-stages";
import { AskTurn } from "./ask-turn";
import { ChatList } from "./chat-list";
import { chatTitle } from "./chat-title";
import {
  DEFAULT_MODE,
  formatDue,
  goalDue,
  goalQuestion,
  goalTone,
  hasSteps,
  modeByKey,
  nextMode,
  selectPlanGoals,
  stepsFromAnswer,
  type ChatMode,
  type ChatModeKey,
  type PlanGoal,
} from "./chat-modes";
import { BookPicker, Composer, ContextMeter, ModelPicker, ModePicker, type ComposerHandle } from "./composer";
import { lastUsage } from "./chat-usage";
import { SourcesPanel } from "./sources-panel";
import { useSubjectChat } from "./use-subject-chat";
import "katex/dist/katex.min.css";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface Subject extends FolderSubject {
  /** Подпись в выборе книги: автор или почему отвечать не по чему. */
  note: string;
}

/** Строка «Режим: X» в идущем разговоре. Только на экране, в базу не пишется. */
interface ModeMark {
  /** После скольких реплик она стоит. */
  at: number;
  key: ChatModeKey;
}

/** Тот же ключ, что у мини-окна: «какая книга открыта» одно на приложение. */
const SUBJECT_KEY = "timely.ask.subject";
/** Значение ключа для разговора без книги. Пустая строка неотличима от «нет». */
const NO_BOOK = "none";
const MODE_KEY = "timely.chat.mode";
const GOALS_KEY = "chat:goals";

/** Ближе к низу, чем на столько, значит ученик читает конец и лента едет за ответом. */
const FOLLOW_GAP = 96;

interface StarterPrompt {
  label: string;
  /** Что подставить в поле. Там ученик допишет своё. */
  fill?: string;
  /** Вопрос готов целиком: уходит сразу. */
  send?: boolean;
  mode?: ChatModeKey;
}

const PROMPTS: StarterPrompt[] = [
  { label: "Объясни тему простыми словами", fill: "Объясни простыми словами: " },
  { label: "Составь план на неделю", fill: "Составь план на неделю", mode: "plan" },
  { label: "Помоги с задачей", fill: "Помоги с задачей: ", mode: "guide" },
  { label: "Как перестать откладывать?", send: true },
];

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Приватный режим без хранилища: просто не запомним выбор.
  }
}

function booksWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "книг";
  if (ones === 1) return "книга";
  if (ones >= 2 && ones <= 4) return "книги";
  return "книг";
}

function buildSubjects(goals: LearningGoal[], documents: CurriculumDocument[]): Subject[] {
  return goals.map((goal) => {
    const own = documents.filter((document) => document.goal === goal.id);
    const ready = own.filter((document) => document.ingestion_status === "ready");
    let note = "нет книги";
    if (ready.length === 1) {
      note = coverAuthor(ready[0].authors) || coverTitle(ready[0].title);
    } else if (ready.length > 1) {
      note = `${ready.length} ${booksWord(ready.length)}`;
    } else if (own.some((document) => !isTerminal(document.ingestion_status))) {
      note = "книга обрабатывается";
    }
    return { goalId: goal.id, title: subjectTitle(goal), books: ready.length, note };
  });
}

/** Книга, выбранная в прошлый раз. Выбор «без книги» тоже считается выбором. */
function rememberedSubject(list: Subject[]): string | null {
  const value = readStored(SUBJECT_KEY);
  return list.some((item) => item.goalId === value) ? value : null;
}

/** На телефоне поле не трогаем: клавиатура закрыла бы половину экрана. */
function focusOnDesktop(composer: ComposerHandle | null) {
  if (window.matchMedia("(hover: hover)").matches) composer?.focus();
}

async function fetchPlanGoals(): Promise<PlanGoal[]> {
  const response = await authFetch(`${BACKEND_URL}/api/goals/`);
  if (!response.ok) throw new Error(`Цели не загрузились (${response.status})`);
  const body = (await response.json()) as PlanGoal[] | { results?: PlanGoal[] };
  return selectPlanGoals(Array.isArray(body) ? body : body.results ?? []);
}

/** На телефоне переписка не прокручивается сама: её везёт вся колонка страницы. */
function scrollerOf(log: HTMLElement | null): HTMLElement | null {
  if (!log) return null;
  return getComputedStyle(log).overflowY === "visible" ? log.closest<HTMLElement>(".main") : log;
}

function closeOnBackdrop(event: React.MouseEvent<HTMLDialogElement>) {
  // Нажатие мимо листа попадает в сам <dialog>: его подложка часть элемента.
  if (event.target === event.currentTarget) event.currentTarget.close();
}

export function ChatPage() {
  const router = useRouter();
  const { chatsSlot } = useDashboardShell();
  const { prompt } = useAskRail();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [documents, setDocuments] = useState<CurriculumDocument[]>([]);
  const [ready, setReady] = useState(false);
  const [subjectsFailed, setSubjectsFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const [modeKey, setModeKey] = useState<ChatModeKey>(DEFAULT_MODE);
  const prefs = useChatPrefs();
  // Список моделей почти не меняется. Не загрузился: выбора просто нет, чат работает.
  const askOptions = useResource("ask:options", fetchAskOptions, { ttl: 60 * 60_000 });
  const [marks, setMarks] = useState<ModeMark[]>([]);
  /** Планирование: показать цели под идущим разговором. */
  const [pickingGoal, setPickingGoal] = useState(false);
  /** Цель, которую разложили на шаги: кнопка «Добавить в план» говорит о ней. */
  const [planGoal, setPlanGoal] = useState<string | null>(null);

  const [wantedChat, setWantedChat] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [pickedPages, setPickedPages] = useState<Record<string, number>>({});
  const [sourcesSheetOpen, setSourcesSheetOpen] = useState(false);

  const composerRef = useRef<ComposerHandle>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const chatsSheet = useRef<HTMLDialogElement>(null);
  const sourcesSheet = useRef<HTMLDialogElement>(null);
  const follow = useRef(true);
  const openingId = useRef<string | null>(null);

  const chat = useSubjectChat({ goalId: selected, scope: "all" });
  const { busy, stop, turns, updateProposal } = chat;
  const mode = modeByKey(modeKey);
  const planning = modeKey === "plan";
  const goals = useResource(planning ? GOALS_KEY : null, fetchPlanGoals);

  // Ученик мог только что поставить цель на соседней странице: кэш прошлого захода уже устарел.
  useEffect(() => {
    invalidateResources(GOALS_KEY);
  }, []);

  // Режим последнего раза. Эффектом: на сервере хранилища нет, и разметка разъехалась бы.
  useEffect(() => {
    setModeKey(modeByKey(readStored(MODE_KEY)).key);
  }, []);

  // Адрес: `?chat=` открывает разговор (кнопка в мини-окне), `?q=` подставляет вопрос в
  // поле, но не отправляет: сначала ученик может выбрать книгу. Параметры сразу убираем,
  // чтобы перезагрузка не делала это заново.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const question = params.get("q")?.trim();
    const wanted = params.get("chat")?.trim();
    if (!question && !wanted) return;
    if (question) composerRef.current?.fill(question.slice(0, 2000));
    if (wanted) setWantedChat(wanted);
    params.delete("q");
    params.delete("chat");
    const rest = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`,
    );
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listGoals(), listDocuments()])
      .then(([goalRows, documentRows]) => {
        if (!alive) return;
        setSubjects(buildSubjects(goalRows, documentRows));
        setDocuments(documentRows);
      })
      .catch(() => {
        if (alive) setSubjectsFailed(true);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const resetTalk = useCallback(() => {
    setMarks([]);
    setPickingGoal(false);
    setPlanGoal(null);
    setOpenFailed(false);
    setPickedPages({});
    follow.current = true;
  }, []);

  const { openChat: engineOpen, startNew: engineNew, chats, chatId, loadingChats } = chat;

  const openChat = useCallback(
    async (id: string) => {
      chatsSheet.current?.close();
      // Уже открыт: перезагрузка только оборвала бы идущий ответ.
      if (id === chatId) return;
      resetTalk();
      openingId.current = id;
      setOpening(true);
      // Разговор помнит свою книгу: продолжать физику, спрашивая по алгебре, нельзя.
      const row = chats.find((item) => item.id === id);
      if (row) setSelected(row.goal);
      const loaded = await engineOpen(id);
      if (openingId.current !== id) return;
      openingId.current = null;
      setOpening(false);
      if (loaded) setSelected(loaded.goal);
      else setOpenFailed(true);
    },
    [chatId, chats, engineOpen, resetTalk],
  );

  /** Закрывает текущий разговор. Открывающийся тоже: его ответ уже никому не нужен. */
  const leaveTalk = useCallback(() => {
    resetTalk();
    openingId.current = null;
    setOpening(false);
    engineNew();
  }, [engineNew, resetTalk]);

  const startNew = useCallback(() => {
    chatsSheet.current?.close();
    leaveTalk();
    setSelected(rememberedSubject(subjects));
    composerRef.current?.focus();
  }, [leaveTalk, subjects]);

  // Сначала книга из прошлого раза, а чат из адреса уже поверх неё. Вопрос, заданный до
  // загрузки предметов, остаётся в том разговоре, где его задали.
  const askedEarly = useRef(false);
  askedEarly.current = turns.length > 0;
  useEffect(() => {
    if (!ready || askedEarly.current) return;
    setSelected(rememberedSubject(subjects));
  }, [ready, subjects]);

  useEffect(() => {
    if (!wantedChat || !ready || loadingChats) return;
    setWantedChat(null);
    void openChat(wantedChat);
  }, [wantedChat, ready, loadingChats, openChat]);

  const changeMode = useCallback(
    (key: ChatModeKey, quiet = false) => {
      if (key === modeKey) return;
      setModeKey(key);
      writeStored(MODE_KEY, key);
      setPickingGoal(key === "plan" && turns.length > 0);
      if (key !== "plan") setPlanGoal(null);
      // В идущем разговоре видно, с какого места тьютор ведёт себя иначе. Строка на каждое
      // место одна: листая режимы, ученик не должен оставлять за собой столбик.
      if (!quiet && turns.length) {
        setMarks((prev) => [...prev.filter((mark) => mark.at !== turns.length), { at: turns.length, key }]);
      }
    },
    [modeKey, turns.length],
  );

  const pickMode = useCallback(
    (key: ChatModeKey) => {
      changeMode(key);
      focusOnDesktop(composerRef.current);
    },
    [changeMode],
  );

  const send = useCallback(
    (text: string) => {
      follow.current = true;
      setOpenFailed(false);
      setPickingGoal(false);
      void chat.ask(text, undefined, modeKey);
    },
    [chat, modeKey],
  );

  const askGoal = useCallback(
    (goal: PlanGoal) => {
      follow.current = true;
      setOpenFailed(false);
      setPlanGoal(goal.title);
      setPickingGoal(false);
      void chat.ask(goalQuestion(goal), undefined, "plan");
    },
    [chat],
  );

  const runPrompt = (item: StarterPrompt) => {
    if (item.mode) changeMode(item.mode, true);
    if (item.send) send(item.label);
    else composerRef.current?.fill(item.fill ?? item.label);
  };

  const pickSubject = useCallback(
    (goalId: string | null) => {
      if (goalId === selected) return;
      setSelected(goalId);
      writeStored(SUBJECT_KEY, goalId ?? NO_BOOK);
      // Книга у разговора одна: она записана в чате и после создания не меняется, иначе в
      // старых ответах остались бы цитаты из книги, которой в предмете нет. Поэтому смена
      // книги начинает новый разговор, а прежний остаётся в списке.
      if (turns.length || opening) leaveTalk();
      focusOnDesktop(composerRef.current);
    },
    [leaveTalk, opening, selected, turns.length],
  );

  const lastTurn = turns[turns.length - 1];
  const usageNow = useMemo(() => lastUsage(turns), [turns]);

  // Лента едет за ответом, только пока ученик читает её конец: прокрутил выше, значит
  // перечитывает, и дёргать его нельзя.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const onScroll = () => {
      const scroller = scrollerOf(log);
      if (!scroller) return;
      follow.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_GAP;
    };
    const main = log.closest<HTMLElement>(".main");
    log.addEventListener("scroll", onScroll, { passive: true });
    main?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      log.removeEventListener("scroll", onScroll);
      main?.removeEventListener("scroll", onScroll);
    };
  }, []);

  useIsoLayoutEffect(() => {
    if (!follow.current || !turns.length) return;
    const scroller = scrollerOf(logRef.current);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [turns, marks, pickingGoal, goals.data]);

  // Новый вопрос снова показывает страницу из свежего ответа.
  useEffect(() => {
    setPickedPages({});
  }, [turns.length]);

  const current = useMemo(
    () => subjects.find((item) => item.goalId === selected) ?? null,
    [subjects, selected],
  );
  const pageCounts = useMemo(
    () => new Map(documents.map((document) => [document.id, document.page_count])),
    [documents],
  );
  const spines = useMemo(() => buildSpines(turns, pageCounts), [turns, pageCounts]);
  const shelf = useMemo(
    () =>
      selected
        ? documents.filter(
            (document) => document.goal === selected && document.ingestion_status === "ready",
          )
        : [],
    [documents, selected],
  );
  const hasSources = shelf.length > 0 || spines.length > 0;

  const showSource = useCallback((documentId: string, page: number) => {
    setPickedPages((prev) => ({ ...prev, [documentId]: page }));
    // На узком экране панели справа нет: те же страницы открываются нижним листом.
    const panel = chatRef.current?.querySelector(".sources");
    if (!panel || getComputedStyle(panel).display === "none") {
      setSourcesSheetOpen(true);
      sourcesSheet.current?.showModal();
      sourcesSheet.current?.focus();
    }
  }, []);

  const jumpToTurn = useCallback((index: number) => {
    sourcesSheet.current?.close();
    follow.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(`turn-${index}`)
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, []);

  const { retryLast } = chat;
  const retry = useCallback(() => {
    follow.current = true;
    void retryLast(modeKey);
  }, [retryLast, modeKey]);

  const addToPlan = () => {
    if (!lastTurn) return;
    const steps = stepsFromAnswer(lastTurn.content);
    prompt({
      target: "schedule",
      text: planGoal ? `Добавь в план по цели «${planGoal}»: ${steps}` : `Добавь в план: ${steps}`,
      send: true,
    });
    // На плане это идёт через предпросмотр: расписание меняет только сам ученик.
    router.push("/dashboard/plan");
  };

  const empty = !turns.length && !opening;
  const answered =
    !busy && lastTurn?.role === "assistant" && Boolean(lastTurn.content) && !lastTurn.error;
  const openRow = chats.find((row) => row.id === chatId);
  const placeholder = modeKey === "plain" && current?.books ? "Спроси по книге" : mode.hint;

  const list = (
    <ChatList
      chats={chats}
      subjects={subjects}
      activeId={chatId}
      loading={loadingChats || !ready}
      failed={chat.chatsFailed}
      onRetry={chat.reloadChats}
      onOpen={(id) => void openChat(id)}
      onCreate={startNew}
      onRename={(id, title) => void chat.renameChat(id, title)}
      onDelete={(id) => {
        if (id === chatId) resetTalk();
        void chat.removeChat(id);
      }}
    />
  );

  const sources = hasSources ? (
    <SourcesPanel
      spines={spines}
      shelf={shelf}
      documents={documents}
      subject={current?.title ?? ""}
      turns={turns}
      pickedPages={pickedPages}
      onPickPage={(documentId, page) =>
        setPickedPages((prev) => ({ ...prev, [documentId]: page }))
      }
      onJump={jumpToTurn}
    />
  ) : null;

  return (
    <div className="content view">
      <SubNav group="tutor" />
      <div
        ref={chatRef}
        className={hasSources ? "chat has-sources" : "chat"}
        data-kind={hasSources ? "book" : "general"}
      >
        <div className="talk">
          <button
            className="chats-fab glass"
            type="button"
            aria-label="Чаты"
            onClick={() => {
              chatsSheet.current?.showModal();
              chatsSheet.current?.focus();
            }}
          >
            <Icon name="chats" />
          </button>
          <div className="chat-bar">
            <span className="chat-now">{chatTitle(openRow?.title)}</span>
          </div>

          <div
            ref={logRef}
            className={empty ? "log log-new" : "log"}
            tabIndex={empty ? undefined : 0}
            role={empty ? undefined : "log"}
            aria-label="Переписка"
            aria-busy={busy}
          >
            {empty ? (
              <EmptyTalk
                mode={mode}
                current={current}
                openFailed={openFailed}
                goals={goals}
                onPrompt={runPrompt}
                onGoal={askGoal}
              />
            ) : null}

            {opening ? <p className="m-think shine">Открываю разговор</p> : null}

            {turns.map((turn, index) => (
              <Fragment key={index}>
                <AskTurn
                  turn={turn}
                  id={`turn-${index}`}
                  showUsage={prefs.showUsage}
                  onCite={showSource}
                  onProposal={updateProposal}
                  onRetry={
                    !busy &&
                    index === turns.length - 1 &&
                    turn.error &&
                    turn.error !== STOPPED_ERROR
                      ? retry
                      : undefined
                  }
                />
                {marks
                  .filter((mark) => mark.at === index + 1)
                  .map((mark) => (
                    <p className="m-mode" key={mark.at}>
                      Режим: {modeByKey(mark.key).name}
                    </p>
                  ))}
              </Fragment>
            ))}

            {!busy && !empty && !opening && planning && pickingGoal ? (
              <>
                <p className="m-ai">К какой цели идём?</p>
                <GoalChips goals={goals} onGoal={askGoal} />
              </>
            ) : null}

            {answered && planning && !pickingGoal ? (
              <div className="m-acts">
                {planGoal || hasSteps(lastTurn.content) ? (
                  <button className="btn btn-line" type="button" onClick={addToPlan}>
                    Добавить в план
                  </button>
                ) : null}
                <button className="btn btn-text" type="button" onClick={() => setPickingGoal(true)}>
                  Другая цель
                </button>
              </div>
            ) : null}

            {answered && !planning && mode.follow.length && !lastTurn.proposals?.length ? (
              <div className="m-acts">
                {mode.follow.map((question, index) => (
                  <button
                    key={question}
                    className={index ? "btn btn-text" : "btn btn-line"}
                    type="button"
                    onClick={() => send(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <Composer
            ref={composerRef}
            onSubmit={send}
            onStop={stop}
            busy={busy}
            disabled={opening}
            placeholder={placeholder}
            onCycleMode={() => changeMode(nextMode(modeKey).key)}
            status={prefs.showUsage && usageNow ? <ContextMeter usage={usageNow} /> : null}
            tools={
              <>
                <ModePicker mode={mode} onPick={pickMode} />
                <BookPicker
                  options={subjects}
                  selected={selected}
                  failed={subjectsFailed}
                  onPick={pickSubject}
                />
                {prefs.showPicker && askOptions.data ? (
                  <ModelPicker
                    options={askOptions.data}
                    model={prefs.model}
                    reasoning={prefs.reasoning}
                    onModel={(key) => setChatPrefs({ model: key })}
                    onReasoning={(key) => setChatPrefs({ reasoning: key })}
                  />
                ) : null}
              </>
            }
          />
        </div>

        {sources}
      </div>

      {chatsSlot ? createPortal(list, chatsSlot) : null}

      <dialog
        ref={chatsSheet}
        className="sheet sheet-chats"
        tabIndex={-1}
        aria-label="Чаты"
        onClick={closeOnBackdrop}
      >
        {list}
      </dialog>

      <dialog
        ref={sourcesSheet}
        className="sheet sheet-sources"
        tabIndex={-1}
        aria-label="Источники"
        onClick={closeOnBackdrop}
        onClose={() => setSourcesSheetOpen(false)}
      >
        {sourcesSheetOpen ? sources : null}
      </dialog>
    </div>
  );
}

function EmptyTalk({
  mode,
  current,
  openFailed,
  goals,
  onPrompt,
  onGoal,
}: {
  mode: ChatMode;
  current: Subject | null;
  openFailed: boolean;
  goals: ResourceState<PlanGoal[]> & { reload: () => void };
  onPrompt: (item: StarterPrompt) => void;
  onGoal: (goal: PlanGoal) => void;
}) {
  const failedLine = openFailed ? <p>Этот чат открыть не получилось. Возможно, его уже удалили.</p> : null;

  if (mode.key === "plan") {
    return (
      <>
        {failedLine}
        <h2>К какой цели идём?</h2>
        <GoalChips goals={goals} onGoal={onGoal} />
      </>
    );
  }

  const line = current
    ? current.books
      ? `Отвечу по книге предмета «${current.title}» и покажу страницу.`
      : `У предмета «${current.title}» пока нет книги, отвечу своими словами.`
    : "Учёба, план, как собраться с мыслями. Можно и по книге.";

  return (
    <>
      {failedLine}
      <h2>О чём поговорим?</h2>
      <p>{line}</p>
      <div className="prompts">
        {PROMPTS.map((item) => (
          <button key={item.label} type="button" onClick={() => onPrompt(item)}>
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** Настоящие цели ученика. Без них обычный вопрос в режиме планирования всё равно работает. */
function GoalChips({
  goals,
  onGoal,
}: {
  goals: ResourceState<PlanGoal[]> & { reload: () => void };
  onGoal: (goal: PlanGoal) => void;
}) {
  if (!goals.data) {
    return goals.error ? (
      <p className="m-note">
        Цели не загрузились.{" "}
        <button className="link" type="button" onClick={goals.reload}>
          Ещё раз
        </button>
      </p>
    ) : (
      <p className="m-think shine">Смотрю цели</p>
    );
  }
  if (!goals.data.length) {
    return (
      <p className="m-note">
        Целей пока нет.{" "}
        <Link className="link" href="/dashboard/goals">
          Поставить цель
        </Link>
      </p>
    );
  }
  return (
    <div className="m-goals">
      {goals.data.map((goal) => {
        const due = formatDue(goalDue(goal));
        return (
          <button key={goal.id} className={`m-goal ${goalTone(goal)}`} type="button" onClick={() => onGoal(goal)}>
            <b>{goal.title}</b>
            <small>{due ? `до ${due}` : "без срока"}</small>
          </button>
        );
      })}
    </div>
  );
}
