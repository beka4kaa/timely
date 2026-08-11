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
import { ChevronDown } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useActiveSubject } from "@/contexts/active-subject";
import { useAskRail } from "@/contexts/ask-rail";
import { isScheduleRailRoute } from "@/config/schedule-rail-routes";
import { useDashboardPath } from "@/lib/use-dashboard-path";
import {
  listDocuments,
  listGoals,
  type CurriculumDocument,
  type LearningGoal,
} from "@/lib/curriculum-api";
import { ChatTree } from "./chat-tree";
import { subjectTitle } from "@/lib/curriculum-catalog";
import { AskTurn } from "@/components/chat/ask-turn";
import { Composer } from "@/components/chat/composer";
import { useSubjectChat } from "@/components/chat/use-subject-chat";
import "katex/dist/katex.min.css";
import { RailShell, railPillButtonClass } from "./rail-shell";
import { ScheduleRail } from "./schedule-rail";

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
  // На «Плане» разговор про календарь, а не про учебник. Разные компоненты, а
  // не флаг внутри одного: у режимов разное состояние и разные запросы, и
  // ветвление хуков внутри одной панели React бы не разрешил.
  const schedule = isScheduleRailRoute(useDashboardPath());
  if (hidden) return null;
  return schedule ? <ScheduleRail /> : <AskRail />;
}

function AskRail() {
  const { open } = useAskRail();
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
    <RailShell
      edgeLabel="Спросить по книге"
      newLabel="Новый чат"
      onNew={chat.startNew}
      feedRef={feedRef}
      title={
        /* Заголовок «По книге» убран: имя чата само называет, что на экране, а
           книга видна по плашке предмета и подсказке в поле ввода. В панели
           этой ширины освободившиеся ~70 px заметны. */
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button type="button" title="Чаты" className={railPillButtonClass}>
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
      }
      footer={
        <Composer
          onSubmit={(text) => void chat.ask(text)}
          busy={chat.busy}
          disabled={!selected}
          suggestions={selected ? SUGGESTIONS : undefined}
        />
      }
    >
      {!chat.turns.length && <EmptyState subject={current} />}
      {chat.turns.map((turn, index) => (
        <AskTurn key={index} turn={turn} />
      ))}
    </RailShell>
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
