"use client";

// Привычки: сетка карточек и строка «что хочешь делать регулярно».
//
// Отметка оптимистичная: карточка откликается сразу, а запрос называет итог и день
// ученика. Частые нажатия идут по одному запросу на привычку, и побеждает последнее.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { listGoals } from "@/components/goals/goals-api";
import { isOpenGoal, suggestGoalFor, type Goal } from "@/components/goals/goal-logic";
import { mascot } from "@/components/shell/mascot/mascot";
import { SubNav } from "@/components/shell/tab-bar";
import { useAskRail } from "@/contexts/ask-rail";
import { RECORD_EVENT, parseHabit, takeRecordParam } from "@/lib/understand";


import { AiLine, useUnderstand } from "./ai-line";
import { HabitCard } from "./habit-card";
import { localDay, markToday, nextHabitColor } from "./habit-days";
import { AiOffer, AiThinking, HabitOffer } from "./habit-offer";
import { createHabit, deleteHabit, listHabits, markHabit, updateHabit, type Habit } from "./lib";

const STEPS = ["Разбираю, что это", "Ищу, к какой цели"];
const UNDO_MS = 6000;

type Offer =
  | { kind: "habit"; name: string; goalId: string | null }
  | { kind: "goal" | "topics" | "question"; text: string };

interface PendingDelete {
  timer: number;
  toastId: string | number;
  fire: (keepalive: boolean) => void;
}

export function HabitsPage() {
  const router = useRouter();
  const { prompt } = useAskRail();
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [adding, setAdding] = useState(false);
  const [freshId, setFreshId] = useState<number | null>(null);
  const { thinking, ask } = useUnderstand("habit", STEPS);

  // То же, что в состоянии: ответы приходят позже, а считать надо от самого свежего.
  const rows = useRef<Habit[]>([]);
  const loadedDay = useRef("");
  const sending = useRef(new Map<number, { wanted: boolean }>());
  const deletions = useRef(new Map<number, PendingDelete>());
  const looked = useRef(false);

  const commit = useCallback((next: Habit[]) => {
    rows.current = next;
    setHabits(next);
  }, []);

  const load = useCallback(async () => {
    const day = localDay();
    try {
      const next = await listHabits(day);
      loadedDay.current = day;
      // Удалённые, но ещё отменяемые не должны вернуться с обновлением.
      commit(next.filter((habit) => !deletions.current.has(habit.id)));
      setFailed(false);
    } catch {
      // Уже показанные карточки не прячем из-за одного неудачного обновления.
      if (rows.current.length === 0) setFailed(true);
    }
  }, [commit]);

  useEffect(() => {
    void load();
    listGoals()
      .then((list) => setGoals(list.filter(isOpenGoal)))
      // Без целей страница всё равно работает: просто не с чем связать.
      .catch(() => setGoals([]));
  }, [load]);

  // Вкладка могла простоять ночь: тогда сегодня это уже другой день и карточки пора перечитать.
  useEffect(() => {
    const check = () => {
      if (!document.hidden && loadedDay.current && loadedDay.current !== localDay()) void load();
    };
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [load]);

  // Пришли по значку привычки с плашки цели: показать, какая это карточка.
  useEffect(() => {
    if (!habits || looked.current) return;
    looked.current = true;
    const id = window.location.hash.slice(1);
    const card = id ? document.getElementById(id) : null;
    if (!card?.classList.contains("hb")) return;
    card.scrollIntoView({ block: "center" });
    card.classList.add("look");
    window.setTimeout(() => card.classList.remove("look"), 1000);
  }, [habits]);

  // Отложенное удаление не должно потеряться, если человек ушёл со страницы.
  useEffect(() => {
    const pending = deletions.current;
    const flush = () => {
      pending.forEach(({ timer, toastId, fire }) => {
        window.clearTimeout(timer);
        toast.dismiss(toastId);
        fire(true);
      });
      pending.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const send = useCallback(
    async (id: number, wanted: boolean) => {
      const queue = sending.current;
      const running = queue.get(id);
      if (running) {
        running.wanted = wanted;
        return;
      }
      const state = { wanted };
      queue.set(id, state);
      try {
        for (;;) {
          const asked = state.wanted;
          const date = rows.current.find((habit) => habit.id === id)?.today ?? localDay();
          const fresh = await markHabit(id, asked, date);
          if (state.wanted !== asked) continue;
          queue.delete(id);
          commit(rows.current.map((habit) => (habit.id === id ? fresh : habit)));
          // В этом дне лежит заметка или время: сервер их бережёт и запись не удаляет.
          if (fresh.doneToday !== asked) toast("В этот день есть заметка, поэтому отметка осталась");
          return;
        }
      } catch {
        queue.delete(id);
        toast.error("Не получилось отметить. Проверь связь и нажми ещё раз");
        void load();
      }
    },
    [commit, load],
  );

  const toggle = useCallback(
    (habit: Habit) => {
      // Сутки сменились, а карточки ещё вчерашние: отмечать нельзя, день был бы не тот.
      if (loadedDay.current !== localDay()) {
        void load();
        return null;
      }
      const current = rows.current.find((row) => row.id === habit.id);
      if (!current) return null;
      const done = !current.doneToday;
      const marked = markToday(current.calendar, current.streak, current.freezeBudget, done);
      const next = rows.current.map((row) =>
        row.id === habit.id ? { ...row, doneToday: done, calendar: marked.calendar, streak: marked.streak } : row,
      );
      commit(next);
      void send(habit.id, done);
      if (done) {
        mascot.hop(1);
        mascot.react("happy", 1);
        if (next.every((row) => row.doneToday)) toast("Все привычки на сегодня закрыты");
      }
      return { done, streak: marked.streak };
    },
    [commit, load, send],
  );

  const change = useCallback(
    async (habit: Habit, patch: { name?: string; goal?: string | null }, shown: Partial<Habit>) => {
      commit(rows.current.map((row) => (row.id === habit.id ? { ...row, ...shown } : row)));
      try {
        const fresh = await updateHabit(habit.id, patch, loadedDay.current || localDay());
        commit(rows.current.map((row) => (row.id === habit.id ? fresh : row)));
      } catch {
        toast.error("Не получилось сохранить. Попробуй ещё раз");
        void load();
      }
    },
    [commit, load],
  );

  const rename = (habit: Habit, name: string) => void change(habit, { name }, { name });

  const link = (habit: Habit, goalId: string | null) => {
    const goal = goals.find((row) => row.id === goalId);
    void change(habit, { goal: goalId }, { goalId, goalTitle: goal?.title ?? "" });
  };

  const remove = (habit: Habit) => {
    const index = rows.current.findIndex((row) => row.id === habit.id);
    commit(rows.current.filter((row) => row.id !== habit.id));
    const fire = (keepalive: boolean) => {
      deletions.current.delete(habit.id);
      deleteHabit(habit.id, { keepalive }).catch(() => {
        toast.error("Не получилось удалить привычку");
        void load();
      });
    };
    const toastId = toast("Привычка удалена", {
      duration: UNDO_MS,
      action: {
        label: "Вернуть",
        onClick: () => {
          const pending = deletions.current.get(habit.id);
          if (!pending) return;
          window.clearTimeout(pending.timer);
          deletions.current.delete(habit.id);
          const next = [...rows.current];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, habit);
          commit(next);
        },
      },
    });
    deletions.current.set(habit.id, { timer: window.setTimeout(() => fire(false), UNDO_MS), toastId, fire });
  };

  const add = async (name: string, goalId: string | null) => {
    setAdding(true);
    try {
      const color = nextHabitColor(rows.current.map((row) => row.color));
      const created = await createHabit({ name, color, goal: goalId }, localDay());
      commit([...rows.current, created]);
      setFreshId(created.id);
      setOffer(null);
      mascot.hop(0.7);
      requestAnimationFrame(() =>
        document.getElementById(`h${created.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    } catch {
      toast.error("Не получилось добавить привычку. Попробуй ещё раз");
    } finally {
      setAdding(false);
    }
  };

  const offerHabit = (name: string) =>
    setOffer({ kind: "habit", name, goalId: suggestGoalFor(name, goals)?.id ?? null });

  const onAsk = (text: string) => {
    setOffer(null);
    void ask(text, (result) => {
      if (result.kind === "habit") offerHabit(result.name);
      else setOffer({ kind: result.kind, text });
    });
  };

  // Запись пришла из мини-окна или чата: дальше как будто её набрали здесь.
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;
  useEffect(() => {
    const incoming = (event: Event) => onAskRef.current(String((event as CustomEvent).detail));
    window.addEventListener(RECORD_EVENT, incoming);
    // Через таймер: в разработке React запускает эффект дважды, а параметр уже будет убран.
    const timer = window.setTimeout(() => {
      const text = takeRecordParam("new");
      if (text) onAskRef.current(text);
    }, 0);
    return () => {
      window.removeEventListener(RECORD_EVENT, incoming);
      window.clearTimeout(timer);
    };
  }, []);

  const goalOptions = useMemo(() => goals.map((goal) => ({ id: goal.id, title: goal.title })), [goals]);
  const doneCount = habits?.filter((habit) => habit.doneToday).length ?? 0;

  return (
    <div className="content view">
      <SubNav group="grow" />
      <header className="head">
        <h1 className="title">Привычки</h1>
        {habits && habits.length > 0 ? (
          <span className="head-note">
            {doneCount} из {habits.length} сегодня
          </span>
        ) : null}
      </header>

      <AiLine
        placeholder="Что хочешь делать регулярно? Например: читать 20 минут каждый день"
        short="Что делать регулярно?"
        label="Новая привычка своими словами"
        onAsk={onAsk}
      />

      {thinking ? <AiThinking /> : null}

      {offer?.kind === "habit" ? (
        <HabitOffer
          name={offer.name}
          goalId={offer.goalId}
          goals={goalOptions}
          onGoal={(goalId) => setOffer({ ...offer, goalId })}
          actions={[
            { label: adding ? "Добавляю…" : "Добавить привычку", main: true, disabled: adding, run: () => void add(offer.name, offer.goalId) },
            { label: "Не надо", run: () => setOffer(null) },
          ]}
        />
      ) : null}
      {offer?.kind === "goal" ? (
        <AiOffer
          say="Это больше похоже на цель со сроком."
          actions={[
            { label: "Открыть как цель", main: true, run: () => router.push(`/dashboard/goals?new=${encodeURIComponent(offer.text)}`) },
            { label: "Всё равно привычка", run: () => offerHabit(parseHabit(offer.text)) },
          ]}
        />
      ) : null}
      {offer?.kind === "topics" ? (
        <AiOffer
          say="Это больше похоже на то, что ты уже изучил. Такое живёт в слабых темах."
          actions={[
            { label: "Открыть слабые темы", main: true, run: () => router.push("/dashboard/weaknesses") },
            { label: "Всё равно привычка", run: () => offerHabit(parseHabit(offer.text)) },
          ]}
        />
      ) : null}
      {offer?.kind === "question" ? (
        <AiOffer
          say="Это больше похоже на вопрос."
          actions={[
            {
              label: "Спросить тьютора",
              main: true,
              run: () => {
                setOffer(null);
                prompt({ target: "book", text: offer.text, send: true });
              },
            },
            { label: "Всё равно привычка", run: () => offerHabit(parseHabit(offer.text)) },
          ]}
        />
      ) : null}

      {habits === null && failed ? (
        <section className="gr-note card" role="alert">
          <h2>Привычки не загрузились</h2>
          <p>Проверь связь и попробуй ещё раз.</p>
          <button className="btn btn-line" type="button" onClick={() => void load()}>
            Попробовать ещё раз
          </button>
        </section>
      ) : habits === null ? (
        <div className="hb-grid" aria-hidden="true">
          <div className="gr-skel" />
          <div className="gr-skel" />
          <div className="gr-skel" />
        </div>
      ) : habits.length === 0 ? (
        <section className="gr-note gr-invite card">
          <svg className="gr-slime" viewBox="0 0 172 122" aria-hidden="true">
            <use href="#art-slime" />
          </svg>
          <div>
            <h2>Пока нет привычек</h2>
            <p>Напиши сверху, что хочешь делать регулярно. Каждый день станет квадратиком на карточке, и отметить можно будет сегодняшний.</p>
          </div>
        </section>
      ) : (
        <div className="hb-grid">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              goals={goalOptions}
              fresh={habit.id === freshId}
              onToggle={toggle}
              onRename={rename}
              onLink={link}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
