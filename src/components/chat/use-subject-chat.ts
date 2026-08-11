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
  type SubjectChatSummary,
} from "@/lib/curriculum-api";
import { readSse } from "@/lib/sse";

export interface Turn extends AskMessage {
  citations?: AskCitation[];
  /** false — модель ответила от себя: в книге ответа не нашлось. */
  grounded?: boolean;
  /** false — у разговора книги и не было. Отличается от `grounded`. */
  library?: boolean;
  error?: string;
  /** Этап, на котором находится ответ. Пусто — работа окончена. */
  stage?: string;
  /** Сколько фрагментов нашлось: попадает в сводку под ответом. */
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
   * `"subject"` — только текущего предмета: так устроена панель, где предмет
   * выбирается сверху и служит папкой. `"all"` — все разом, для страницы, где
   * история идёт сплошной лентой по дням.
   */
  scope?: "subject" | "all";
  /** Пока `false`, ничего не грузится: панель закрыта — запросов быть не должно. */
  enabled?: boolean;
  /**
   * Открывать последний разговор предмета сразу после загрузки списка.
   *
   * Так устроена панель: она узкая, живёт на всех страницах и продолжает
   * начатое. Страница, наоборот, открывается чистым листом с приветствием —
   * там прошлый разговор в один клик слева.
   */
  autoOpenLatest?: boolean;
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
  ask: (question: string, history?: Turn[]) => Promise<void>;
  stop: () => void;
  startNew: () => void;
  openChat: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
}

export function useSubjectChat({
  goalId,
  scope = "subject",
  enabled = true,
  autoOpenLatest = false,
  migrateLegacy = false,
}: UseSubjectChatOptions): SubjectChatEngine {
  const [chats, setChats] = useState<SubjectChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Предмет открытого разговора. Список чатов в режиме «все» от смены предмета
  // не перезагружается, но новый вопрос должен уйти в тот предмет, который
  // выбран СЕЙЧАС, — поэтому он читается из рефа, а не из замыкания `ask`.
  const goalRef = useRef(goalId);
  goalRef.current = goalId;

  // То же для открытого разговора: список может приехать позже, чем ученик
  // нажмёт «Новый чат», и подставлять ему вчерашний разбор поверх пустого
  // экрана нельзя.
  const openedRef = useRef<{ chatId: string | null; turns: Turn[] }>({
    chatId: null,
    turns: [],
  });
  openedRef.current = { chatId, turns };

  // Список: в режиме предмета перезагружается при его смене, в режиме «все» —
  // один раз. Ключ строкой, потому что `null` — это законный предмет («без
  // книги»), и отличать его от «ещё не выбран» приходится явно.
  const listKey = scope === "all" ? "all" : String(goalId);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoadingChats(true);
    void (async () => {
      const subject = goalRef.current;
      if (migrateLegacy && subject) await migrateLegacyTurns(subject);
      const rows = await listChats(
        scope === "all" ? undefined : subject,
      ).catch(() => []);
      if (!alive) return;
      setChats(rows);
      setLoadingChats(false);
      // Продолжаем последний разговор — но только если на экране пусто.
      // Сравнение с `goalRef` обязательно: пока шёл запрос, ученик мог
      // переключить предмет, и открывшийся чат оказался бы из другого.
      const idle =
        !openedRef.current.chatId && !openedRef.current.turns.length;
      if (autoOpenLatest && idle && rows[0] && goalRef.current === subject) {
        setChatId(rows[0].id);
        const restored = await loadChatTurns(rows[0].id);
        if (alive && goalRef.current === subject) setTurns(restored);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, enabled, scope, autoOpenLatest, migrateLegacy]);

  // Панель показывает чаты одного предмета, и открытый разговор из другого
  // предмета в ней выглядел бы чужим. На странице список общий, и закрывать
  // разговор при смене предмета в композере незачем.
  useEffect(() => {
    if (scope !== "subject") return;
    abortRef.current?.abort();
    setChatId(null);
    setTurns([]);
  }, [goalId, scope]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (question: string, historySource?: Turn[]) => {
      const text = question.trim();
      if (!text || busy) return;

      // Обрываем предыдущий поток: два ответа в одну ленту неразличимы.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = (historySource ?? turns)
        .filter((turn) => !turn.error && turn.content)
        .map(({ role, content }) => ({ role, content }));

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

      const patchLast = (patch: Partial<Turn>) =>
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], ...patch };
          return next;
        });

      try {
        const response = await askSubjectStream(
          { goal_id: goal, message: text, history },
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
              library: data.library !== false,
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
    [busy, turns],
  );

  // Сохраняем после завершённого ответа, а не на каждую букву потока: иначе на
  // один вопрос уходит сотня запросов.
  useEffect(() => {
    if (busy || !turns.length) return;
    let alive = true;
    void (async () => {
      const saved = await persistTurns({
        chatId,
        goalId: goalRef.current,
        turns,
      });
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
  }, [turns, busy, chatId]);

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
        : { ...last, stage: "", error: "Остановлено." };
      return next;
    });
  }, []);

  /** Чистое состояние. Строка в базе появится с первым вопросом. */
  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setChatId(null);
    setTurns([]);
  }, []);

  const openChat = useCallback(async (id: string) => {
    abortRef.current?.abort();
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
    ask,
    stop,
    startNew,
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
  goalId: string | null;
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
