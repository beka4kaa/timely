"use client";

// Движок разговора: поток ответа, история, сохранение, список чатов.
//
// Вынесен из панели (`tutor-rail/subject-ask-rail.tsx`), где всё это лежало
// внутри компонента и не экспортировалось. Панель и страница «Тьютор» — это две
// РАСКЛАДКИ одного разговора, и вторая копия движка разъехалась бы с первой на
// первой же правке: ровно так уже случилось с чатом доски, у которого от общего
// осталось только оформление.
//
// Здесь нет ни одного класса Tailwind и ни одного элемента — только состояние.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  askSubjectStream,
  createChat,
  deleteChat,
  getChat,
  listChats,
  renameChatAutomatically,
  updateChat,
  type AskCitation,
  type AskMessage,
  type SubjectChat,
  type SubjectChatSummary,
} from "@/lib/curriculum-api";
import { chatPrefs } from "@/lib/chat-prefs";
import { readSse } from "@/lib/sse";

import type { AskUsage } from "./chat-usage";

import { STOPPED_ERROR } from "./ask-stages";
import { historyContent, type AssistantProposal } from "./assistant-proposal";

export interface Turn extends AskMessage {
  /** Сколько стоил ответ. Показывается по настройке. */
  usage?: AskUsage;
  citations?: AskCitation[];
  /** false — модель ответила от себя: в книге ответа не нашлось. */
  grounded?: boolean;
  /** false — у разговора книги и не было. Отличается от `grounded`. */
  library?: boolean;
  error?: string;
  /** Этап, на котором находится ответ. Пусто — работа окончена. */
  stage?: string;
  /** Что сейчас смотрит тьютор: подпись от сервера, пока идёт этап `tool`. */
  toolLabel?: string;
  /** Что он предлагает поменять в делах ученика. */
  proposals?: AssistantProposal[];
  /** Сколько фрагментов нашлось. */
  found?: number;
  /** Длительность работы, мс. */
  durationMs?: number;
}

/** Сколько реплик храним. Без потолка разговор растёт неделями. */
export const MAX_STORED_TURNS = 40;

/** Ключи прежнего хранения в браузере: `timely.ask.<uuid предмета>`. */
const LEGACY_PREFIX = "timely.ask.";
const LEGACY_TITLE = "Прежний разговор";

export interface UseSubjectChatOptions {
  /** Предмет текущего разговора. `null` — без книги. */
  goalId: string | null;
  /**
   * Какие чаты держать в списке.
   *
   * `"subject"` — только текущего предмета: так устроено мини-окно, где предмет
   * выбирается в поле. `"all"` — все разом, для страницы чата.
   */
  scope?: "subject" | "all";
  /** Пока `false`, ничего не грузится: панель закрыта — запросов быть не должно. */
  enabled?: boolean;
  /** Страница, с которой спрашивают: на привычках «добавь чтение» это привычка. */
  page?: string;
  /**
   * Разовый перенос разговора, накопленного в браузере до появления чатов.
   *
   * Делается здесь, а не снаружи, потому что успеть надо строго ДО запроса
   * списка: иначе перенесённый чат не появится до перезагрузки страницы.
   */
  migrateLegacy?: boolean;
}

export interface SubjectChatEngine {
  turns: Turn[];
  busy: boolean;
  chats: SubjectChatSummary[];
  chatId: string | null;
  /** Идёт первая загрузка списка. */
  loadingChats: boolean;
  /** Список не загрузился. Пустым он от этого не становится. */
  chatsFailed: boolean;
  reloadChats: () => void;
  /** `mode` — как тьютор ведёт разговор. Без него обычный режим. */
  ask: (question: string, history?: Turn[], mode?: string) => Promise<void>;
  /** Спросить заново то, на что не удалось ответить: неудачная пара уходит с экрана. */
  retryLast: (mode?: string) => Promise<void>;
  stop: () => void;
  startNew: () => void;
  /** Решение ученика по карточке. Хранится вместе с ответом. */
  updateProposal: (id: string, patch: Partial<AssistantProposal>) => void;
  /** Открывает разговор. `null` — открыть не вышло: удалён или нет связи. */
  openChat: (id: string) => Promise<SubjectChat | null>;
  removeChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
}

/**
 * Один разговор на экране. Новый объект на каждое открытие и на каждый новый чат: всё,
 * что успело уйти в сеть для прошлого разговора, узнаёт по нему, что уже опоздало.
 */
interface Conversation {
  /** Строка в базе. Пусто, пока разговор ни разу не сохранён. */
  id: string | null;
}

export function useSubjectChat({
  goalId,
  scope = "subject",
  enabled = true,
  page,
  migrateLegacy = false,
}: UseSubjectChatOptions): SubjectChatEngine {
  const [chats, setChats] = useState<SubjectChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatsFailed, setChatsFailed] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const conversation = useRef<Conversation>({ id: null });
  // Реплики, которые в базе уже есть: загруженные и только что записанные.
  const storedTurns = useRef<Turn[] | null>(null);
  // Записи идут строго по очереди: второй ответ не должен обогнать создание чата,
  // иначе один разговор лёг бы в базу двумя строками.
  const saves = useRef<Promise<void>>(Promise.resolve());

  // Предмет открытого разговора. Список чатов в режиме «все» от смены предмета
  // не перезагружается, но новый вопрос должен уйти в тот предмет, который
  // выбран СЕЙЧАС, — поэтому он читается из рефа, а не из замыкания `ask`.
  const goalRef = useRef(goalId);
  goalRef.current = goalId;

  /**
   * Переход к другому разговору. Лента очищается сразу: пока новая не загружена, на экране
   * не должно быть старых реплик, иначе они записались бы в чужой чат.
   */
  const switchTo = useCallback((id: string | null) => {
    abortRef.current?.abort();
    conversation.current = { id };
    setChatId(id);
    setTurns([]);
  }, []);

  // Список: в режиме предмета перезагружается при его смене, в режиме «все» —
  // один раз. Ключ строкой, потому что `null` — это законный предмет («без
  // книги»), и отличать его от «ещё не выбран» приходится явно.
  //
  // Последний разговор ЗДЕСЬ НЕ ОТКРЫВАЕТСЯ. Чат начинается с чистого листа —
  // и в панели, и на странице; прошлые разговоры в одном клике, в списке.
  // Подставлять вчерашний разбор человеку, который пришёл спросить новое,
  // значит заставлять его сначала это убрать.
  const listKey = scope === "all" ? "all" : String(goalId);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoadingChats(true);
    setChatsFailed(false);
    void (async () => {
      const subject = goalRef.current;
      if (migrateLegacy && subject) await migrateLegacyTurns(subject);
      const rows = await listChats(
        scope === "all" ? undefined : subject,
      ).catch(() => null);
      if (!alive) return;
      setChats(rows ?? []);
      setChatsFailed(rows === null);
      setLoadingChats(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, enabled, scope, migrateLegacy, listAttempt]);

  const reloadChats = useCallback(() => setListAttempt((value) => value + 1), []);

  // Панель показывает чаты одного предмета, и открытый разговор из другого
  // предмета в ней выглядел бы чужим. На странице список общий, и закрывать
  // разговор при смене предмета в композере незачем.
  useEffect(() => {
    if (scope !== "subject") return;
    switchTo(null);
  }, [goalId, scope, switchTo]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (question: string, historySource?: Turn[], mode?: string) => {
      const text = question.trim();
      if (!text || busy) return;

      // Обрываем предыдущий поток: два ответа в одну ленту неразличимы.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = (historySource ?? turns)
        .filter((turn) => !turn.error && turn.content)
        .map((turn) => ({ role: turn.role, content: historyContent(turn) }));

      setBusy(true);
      const startedAt = Date.now();
      const goal = goalRef.current;
      setTurns((prev) => [
        ...prev,
        { role: "user", content: text },
        // Без книги искать негде, и первым этапом сразу «отвечаю»: иначе
        // заметка обещала бы поиск, которого не будет.
        { role: "assistant", content: "", stage: goal ? "retrieving" : "answering" },
      ]);

      // Прерванный поток может ещё отдать то, что лежит в буфере. Это уже чужая лента.
      const patchLast = (patch: Partial<Turn>) => {
        if (controller.signal.aborted) return;
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], ...patch };
          return next;
        });
      };

      try {
        const prefs = chatPrefs();
        const response = await askSubjectStream(
          {
            goal_id: goal,
            message: text,
            history,
            ...(mode ? { mode } : {}),
            // Читается в момент вопроса: мини-окно отвечает той же моделью, что и чат.
            ...(prefs.model ? { model: prefs.model } : {}),
            ...(prefs.reasoning ? { reasoning: prefs.reasoning } : {}),
            // «Завтра» у ученика, а не на сервере.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(page ? { page } : {}),
          },
          controller.signal,
        );
        let answer = "";
        let failed = false;
        const proposals: AssistantProposal[] = [];
        for await (const { event, data } of readSse(response)) {
          if (event === "stage") {
            patchLast({
              stage: String(data.stage ?? ""),
              toolLabel: typeof data.label === "string" ? data.label : undefined,
              ...(typeof data.found === "number" ? { found: data.found } : {}),
            });
          } else if (event === "content") {
            answer += String(data.delta ?? "");
            patchLast({ content: answer, stage: "answering", toolLabel: undefined });
          } else if (event === "citations") {
            patchLast({
              citations: (data.items as AskCitation[]) ?? [],
              grounded: Boolean(data.grounded),
              library: data.library !== false,
            });
          } else if (event === "proposal") {
            proposals.push(data as unknown as AssistantProposal);
            patchLast({ proposals: [...proposals] });
          } else if (event === "usage") {
            patchLast({ usage: data as unknown as AskUsage });
          } else if (event === "done") {
            patchLast({ stage: "", toolLabel: undefined, durationMs: Date.now() - startedAt });
          } else if (event === "error") {
            failed = true;
            patchLast({ stage: "", toolLabel: undefined, error: String(data.error ?? "Ошибка") });
          }
        }
        if (!answer && !failed) {
          patchLast({ stage: "", toolLabel: undefined, error: "Пустой ответ." });
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
    [busy, turns, page],
  );

  const retryLast = useCallback(
    async (mode?: string) => {
      const question = turns[turns.length - 2];
      if (busy || question?.role !== "user") return;
      const earlier = turns.slice(0, -2);
      setTurns(earlier);
      await ask(question.content, earlier, mode);
    },
    [ask, busy, turns],
  );

  // Сохраняем после завершённого ответа, а не на каждую букву потока: иначе на
  // один вопрос уходит сотня запросов. То, что только что загружено или записано,
  // второй раз не пишем: открытие чата не должно поднимать его наверх списка.
  useEffect(() => {
    if (busy || !turns.length || turns === storedTurns.current) return;
    storedTurns.current = turns;
    const convo = conversation.current;
    const goal = goalRef.current;
    const showRow = (row: SubjectChatSummary) => {
      const stillHere = conversation.current === convo;
      if (stillHere) setChatId(row.id);
      // В мини-окне ушедший разговор мог быть по другому предмету, и в этом списке ему
      // не место. На странице список общий, и строка должна появиться в любом случае.
      if (!stillHere && scope !== "all") return;
      setChats((prev) =>
        prev.some((item) => item.id === row.id)
          ? prev.map((item) => (item.id === row.id ? { ...item, ...row } : item))
          : [row, ...prev],
      );
    };
    const showTitle = (id: string, title: string) =>
      setChats((prev) =>
        prev.map((item) => (item.id === id ? { ...item, title } : item)),
      );
    saves.current = saves.current.then(() =>
      persistTurns({ convo, goalId: goal, turns, showRow, showTitle }),
    );
  }, [turns, busy, scope]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role !== "assistant" || !last.stage) return prev;
      // Оборванный ответ остаётся на экране: то, что модель успела сказать,
      // ученику уже пригодилось. Пустой — заменяется пометкой.
      next[next.length - 1] = last.content
        ? { ...last, stage: "" }
        : { ...last, stage: "", error: STOPPED_ERROR };
      return next;
    });
  }, []);

  /** Чистое состояние. Строка в базе появится с первым вопросом. */
  const startNew = useCallback(() => switchTo(null), [switchTo]);

  const updateProposal = useCallback((id: string, patch: Partial<AssistantProposal>) => {
    setTurns((prev) =>
      prev.map((turn) =>
        turn.proposals?.some((item) => item.id === id)
          ? {
              ...turn,
              proposals: turn.proposals.map((item) =>
                item.id === id ? ({ ...item, ...patch } as AssistantProposal) : item,
              ),
            }
          : turn,
      ),
    );
  }, []);

  const openChat = useCallback(
    async (id: string) => {
      switchTo(id);
      const convo = conversation.current;
      // Чат мог быть удалён с другого устройства — показываем пустой, а не роняем панель.
      const loaded = await getChat(id).catch(() => null);
      // Пока ехал ответ, ученик ушёл к другому разговору: этот уже никому не нужен.
      if (conversation.current !== convo) return loaded;
      if (!loaded) {
        switchTo(null);
        return null;
      }
      const messages = (loaded.messages as Turn[]) ?? [];
      storedTurns.current = messages;
      setTurns(messages);
      // Ссылка могла вести на чат, которого в загруженном списке нет.
      setChats((prev) =>
        prev.some((item) => item.id === id) || scope !== "all"
          ? prev
          : [{ ...loaded, message_count: messages.length }, ...prev],
      );
      return loaded;
    },
    [switchTo, scope],
  );

  const removeChat = useCallback(
    async (id: string) => {
      await deleteChat(id).catch(() => undefined);
      setChats((prev) => prev.filter((row) => row.id !== id));
      if (conversation.current.id === id) switchTo(null);
    },
    [switchTo],
  );

  const renameChat = useCallback(async (id: string, title: string) => {
    const clean = title.trim().slice(0, 200);
    if (!clean) return;
    // Имя на экране меняется сразу: ждать ответа сервера, чтобы увидеть только
    // что набранную строку, незачем.
    setChats((prev) =>
      prev.map((row) => (row.id === id ? { ...row, title: clean } : row)),
    );
    await updateChat(id, { title: clean }).catch(() => undefined);
  }, []);

  return {
    turns,
    busy,
    chats,
    chatId,
    loadingChats,
    chatsFailed,
    reloadChats,
    ask,
    retryLast,
    stop,
    startNew,
    updateProposal,
    openChat,
    removeChat,
    renameChat,
  };
}

/**
 * Переносит разговор, накопленный в браузере до появления чатов.
 *
 * Ему несколько дней, но это сообщения ученика, и стирать их молча нельзя.
 * Ключ убирается в любом случае: повторный перенос создал бы дубли.
 */
async function migrateLegacyTurns(goalId: string): Promise<void> {
  const key = `${LEGACY_PREFIX}${goalId}`;
  const raw = window.localStorage.getItem(key);
  if (!raw) return;
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

/**
 * Пишет разговор в базу.
 *
 * Чат создаётся здесь, а не при нажатии «Новый чат»: иначе список зарастал бы
 * пустыми строками от каждого случайного нажатия. Отказ молчаливый: разговор на
 * экране остаётся и сохранится со следующим ответом.
 */
async function persistTurns({
  convo,
  goalId,
  turns,
  showRow,
  showTitle,
}: {
  convo: Conversation;
  goalId: string | null;
  turns: Turn[];
  showRow: (row: SubjectChatSummary) => void;
  showTitle: (id: string, title: string) => void;
}): Promise<void> {
  const messages = turns.slice(-MAX_STORED_TURNS);
  try {
    if (convo.id) {
      const updated = await updateChat(convo.id, { messages });
      showRow({ ...updated, message_count: messages.length });
      return;
    }
    const created = await createChat(goalId, { messages });
    convo.id = created.id;
    showRow({ ...created, message_count: messages.length });
    // Название придумывается после первого ответа и отдельным запросом: внутри
    // потока ученик ждал бы ещё и заголовок, которого не видит.
    const title = await renameChatAutomatically(created.id);
    if (title) showTitle(created.id, title);
  } catch {
    // Разговор на экране остаётся; сохранится со следующим ответом.
  }
}
