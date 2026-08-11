"use client";

// Панель вопросов по книге. Закреплена справа на всех страницах дашборда.
//
// Здесь осталась только РАСКЛАДКА: выбор предмета, шапка с деревом чатов, лента
// и поле. Сам разговор — поток ответа, история, сохранение, список чатов —
// живёт в `chat/use-subject-chat.ts`, реплики рисует `chat/ask-turn.tsx`, поле
// собирает `chat/composer.tsx`. Страница «Тьютор» берёт те же три модуля и
// раскладывает их иначе; вторая копия движка разъехалась бы с этой на первой
// правке — ровно так уже случилось с чатом доски.
//
// Оформление — то же, что у чата доски (`board/ai-chat.tsx`): та же тёплая
// палитра, те же размеры пузырей, та же кнопка отправки. Скопирован ВИД, а не
// код: сам чат — две тысячи строк, завязанных на whiteboard-стор.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, PanelRightClose, Plus } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useActiveSubject } from "@/contexts/active-subject";
import { useAskRail } from "@/contexts/ask-rail";
import {
  listDocuments,
  listGoals,
  type CurriculumDocument,
  type LearningGoal,
} from "@/lib/curriculum-api";
import { ChatTree } from "./chat-tree";
import { EdgeTab } from "./edge-tab";
import { subjectTitle } from "@/lib/curriculum-catalog";
import { AskTurn } from "@/components/chat/ask-turn";
import { Composer } from "@/components/chat/composer";
import { useSubjectChat } from "@/components/chat/use-subject-chat";
import "katex/dist/katex.min.css";
import { RailResizer } from "./rail-resizer";

interface Subject {
  goalId: string;
  title: string;
  books: number;
}

/** Предмет, выбранный в прошлый раз. Разговоры хранит база, не браузер. */
const SUBJECT_KEY = "timely.ask.subject";

const SUGGESTIONS = ["Объясни проще", "Приведи пример", "С чего начать"];

export function SubjectAskRail() {
  // На странице «Тьютор» панели нет: чат внутри чата бессмыслен. Обёртка, а не
  // ранний выход внутри самой панели, — так вместе с разметкой размонтируется
  // и разговор, и лишних запросов со страницы чата не уходит.
  const { hidden } = useAskRail();
  if (hidden) return null;
  return <AskRail />;
}

function AskRail() {
  const { open, toggle, isMobile, width, dragging } = useAskRail();
  const { goalId: pageGoalId } = useActiveSubject();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const chat = useSubjectChat({
    goalId: selected,
    enabled: open && Boolean(selected),
    migrateLegacy: true,
  });

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
    const remembered = window.localStorage.getItem(SUBJECT_KEY);
    const known = subjects.find((item) => item.goalId === remembered);
    setSelected((known ?? subjects[0]).goalId);
  }, [subjects, selected]);

  useEffect(() => {
    if (selected) window.localStorage.setItem(SUBJECT_KEY, selected);
  }, [selected]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [chat.turns]);

  const current = useMemo(
    () => subjects?.find((item) => item.goalId === selected) ?? null,
    [subjects, selected],
  );

  /** Название текущего чата для шапки. Пусто у ещё не сохранённого. */
  const currentChatTitle = useMemo(
    () => chat.chats.find((row) => row.id === chat.chatId)?.title ?? "",
    [chat.chats, chat.chatId],
  );

  return (
    <>
      {/* ── Закладка ────────────────────────────────────────────────────── */}
      {/* Только открывает. Свернуть можно из шапки, рядом с «Новым чатом»:
          две кнопки одного назначения в разных углах экрана — это лишний
          поиск глазами.

          Стоит по центру правого края — там же, где у открытой панели засечка
          сгиба, и уезжает за край ровно тем движением, каким панель выезжает
          из-за него. */}
      <EdgeTab
        side="right"
        hidden={open}
        label="Спросить по книге"
        onClick={toggle}
        // Половина шапки: панель начинается под ней, и без сдвига закладка
        // встала бы выше засечки сгиба, в которую превращается.
        offsetY={24}
        // Выше страницы (`z-[95]`), но ниже самой панели (`z-[115]`): уезжая,
        // закладка должна скрыться ЗА её кромкой, а не поверх неё.
        className="z-[110]"
      />

      {/* ── Затемнение на узком экране ──────────────────────────────────── */}
      {isMobile && open && (
        <div
          className="fixed inset-0 top-12 z-[110] bg-black/40 backdrop-blur-sm"
          onClick={toggle}
        />
      )}

      {/* ── Панель ──────────────────────────────────────────────────────── */}
      <aside
        style={{ width: isMobile ? "100%" : width || undefined }}
        className={`fixed bottom-0 right-0 top-12 z-[115] border-l border-[#dedbd4] ${
          dragging ? "" : "transition-transform duration-300 ease-in-out"
        } ${
          // Тень слева: лист, приподнятый над страницей, а не приклеенный к
          // ней встык. Закрытой она не нужна — панель за краем экрана.
          open
            ? "translate-x-0 shadow-[-18px_0_40px_-24px_rgba(67,57,45,0.25)]"
            : "translate-x-full"
        }`}
        aria-hidden={!open}
        // Панель уезжает трансформацией и остаётся в DOM. Без этого её поле
        // ввода ловило бы фокус по Tab со страницы, где панели не видно.
        //
        // Атрибут именно ОТСУТСТВУЕТ, когда панель открыта: `inert` булев по
        // спецификации, и `inert="false"` браузер считает включённым.
        inert={open ? undefined : true}
      >
        {open && !isMobile && <RailResizer />}
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
                  chats={chat.chats}
                  selectedGoalId={selected}
                  selectedChatId={chat.chatId}
                  onSelectSubject={setSelected}
                  onSelectChat={(id) => {
                    setPickerOpen(false);
                    void chat.openChat(id);
                  }}
                  onCreate={() => {
                    setPickerOpen(false);
                    chat.startNew();
                  }}
                  onDelete={(id) => void chat.removeChat(id)}
                />
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-0.5 text-[#918b82]">
              <button
                type="button"
                onClick={chat.startNew}
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
            {!chat.turns.length && <EmptyState subject={current} />}
            {chat.turns.map((turn, index) => (
              <AskTurn key={index} turn={turn} />
            ))}
          </div>

          <div
            className="shrink-0 px-3 pt-2"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            <Composer
              onSubmit={(text) => void chat.ask(text)}
              busy={chat.busy}
              disabled={!selected}
              suggestions={selected ? SUGGESTIONS : undefined}
            />
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
