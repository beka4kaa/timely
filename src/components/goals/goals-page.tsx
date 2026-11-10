"use client";

// Цели: главная большой плашкой, остальные сеткой, ниже то, что ученик изучает.
//
// Плашка показывает путь положением слайма. Запись обычным CRUD: каждое действие меняет
// одну цель, а кто теперь главная, решает сервер, поэтому после записи список перечитывается.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { AiLine, useUnderstand } from "@/components/habits/ai-line";
import { CardMenu } from "@/components/habits/card-menu";
import { localDay, nextHabitColor, plural } from "@/components/habits/habit-days";
import { AiOffer, AiThinking, HabitOffer } from "@/components/habits/habit-offer";
import { EVERY_DAY, schedulePatch, type HabitSchedule } from "@/components/habits/habit-schedule";
import { createHabit, listHabits, updateHabit, type Habit } from "@/components/habits/lib";
import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { SubNav } from "@/components/shell/tab-bar";
import { useAskRail } from "@/contexts/ask-rail";
import { ConfirmingAction, OverflowMenu } from "@/components/curriculum/catalog-menu";
import { invalidatePlan } from "@/components/now/now-resources";
import { deleteGoal as deleteSubjectGoal } from "@/lib/curriculum-api";
import { coverClass } from "@/lib/curriculum-cover";
import { dataChanged, useDataChanged } from "@/lib/data-changed";
import { subjectsChanged, topicsChanged } from "@/lib/weak-topics-api";
import { parseGoal, type Understood } from "@/lib/understand";

// Цвета обложек предметов лежат там же, где сами книги: физика везде одного цвета.

import { GoalCard, GoalDone, GoalHero, RidgeArt } from "./goal-plaque";
import { GoalLinks, GoalSheet, type GoalDraft } from "./goal-sheet";
import {
  TONES,
  defaultDue,
  formatDay,
  habitIdeasFor,
  isOpenGoal,
  isShownGoal,
  deleteSubjectWarning,
  matchLessons,
  nextStepText,
  suggestGoalFor,
  type Goal,
} from "./goal-logic";
import { createGoal, listGoals, moveGoalProgress, updateGoal } from "./goals-api";
import { loadLessons, type Lesson } from "./lessons-data";

const STEPS = ["Разбираю, что это", "Ищу сроки и уроки", "Подбираю привычки"];
const UNDO_MS = 6000;
/** Сотня это завершённая цель. Ползунок до неё не доходит: завершают отдельной кнопкой. */
const SLIDER_MAX = 95;

type Filter = "" | "study" | "general";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "", label: "Все" },
  { value: "study", label: "Учёба" },
  { value: "general", label: "Общие" },
];

type Offer =
  | { kind: "habit"; text: string; name: string; goalId: string | null; schedule: HabitSchedule }
  | { kind: "topics"; text: string };

function motionOk(): boolean {
  return window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
}

/** Звезда переносит плашку на новое место плавно, если браузер это умеет. */
function withTransition(change: () => void) {
  const page = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (page.startViewTransition && motionOk()) page.startViewTransition(() => flushSync(change));
  else change();
}

export function GoalsPage() {
  const router = useRouter();
  const { prompt } = useAskRail();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [lessonsFailed, setLessonsFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<GoalDraft | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; value: number } | null>(null);
  // На сервере страница рисуется без дат: цели приходят уже в браузере.
  const [today, setToday] = useState(localDay);
  const { thinking, ask } = useUnderstand("goal", STEPS);

  // Ответ разбора приходит позже: окно открывается по самым свежим данным.
  const latest = useRef({ goals: [] as Goal[], habits: [] as Habit[], lessons: [] as Lesson[] });
  latest.current = { goals: goals ?? [], habits, lessons: lessons ?? [] };
  // Ответ на старый запрос не должен затирать более новый список.
  const asked = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++asked.current;
    try {
      const next = await listGoals();
      if (mine !== asked.current) return;
      setGoals(next);
      setFailed(false);
    } catch {
      if (mine === asked.current) setFailed(true);
    }
  }, []);

  const refreshHabits = useCallback(async () => {
    try {
      setHabits(await listHabits(localDay()));
    } catch {
      // Плашки цели живут и без значков привычек.
    }
  }, []);

  const refreshLessons = useCallback(async () => {
    setLessonsFailed(false);
    try {
      setLessons(await loadLessons());
    } catch {
      setLessonsFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshLessons();
  }, [refresh, refreshLessons]);

  // Серии на значках считаются от сегодня, поэтому новый день перечитывает и их.
  useEffect(() => {
    void refreshHabits();
  }, [refreshHabits, today]);

  // Вкладка могла простоять ночь: «осталось 3 дня» к утру уже неправда.
  useEffect(() => {
    const tick = () => setToday(localDay());
    document.addEventListener("visibilitychange", tick);
    const timer = window.setInterval(tick, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", tick);
      window.clearInterval(timer);
    };
  }, []);

  const shown = useMemo(() => (goals ?? []).filter(isShownGoal), [goals]);
  const open = useMemo(() => shown.filter(isOpenGoal), [shown]);
  const reached = useMemo(() => shown.filter((goal) => goal.status === "done"), [shown]);
  const fits = (goal: Goal) => !filter || goal.scope === filter;
  const withMove = (goal: Goal): Goal =>
    moving?.id === goal.id ? { ...goal, progress: moving.value } : goal;

  const main = open.find((goal) => goal.isMain) ?? null;
  const rest = open.filter((goal) => goal !== main && fits(goal));
  const lessonsOf = (goal: Goal) => (lessons ?? []).filter((lesson) => goal.lessons.includes(lesson.id));
  const habitsOf = (goal: Goal) => habits.filter((habit) => habit.goalId === goal.id);

  const nextFor = (goal: Goal): string | null => {
    const steps = lessonsOf(goal).flatMap((lesson) => (lesson.next ? [lesson.next] : []));
    if (steps.length === 0) return null;
    const first = steps.reduce((best, step) => (step.startAt < best.startAt ? step : best));
    return nextStepText(first.title, first.startAt);
  };

  // ── Окно цели ──

  const openSheet = useCallback((draft: Partial<GoalDraft>) => {
    const day = localDay();
    const all = latest.current.habits;
    const named = (name: string) => all.some((habit) => habit.name.toLowerCase() === name.toLowerCase());
    setSheet({
      id: null,
      title: "",
      scope: "study",
      due: defaultDue(day),
      tone: TONES[latest.current.goals.filter(isOpenGoal).length % TONES.length],
      lessons: [],
      habitIds: [],
      newHabits: [],
      ideas: ["Решать 3 задачи", "Повторять темы"].filter((name) => !named(name)),
      note: "",
      progress: 0,
      ...draft,
    });
  }, []);

  /** Что разобрала модель превращается в заполненное окно. Сохраняет человек. */
  const openFromText = useCallback(
    (result: Extract<Understood, { kind: "goal" }>) => {
      const all = latest.current.habits;
      const ideas = result.habits.length ? result.habits : habitIdeasFor(result.title, result.scope);
      const same = (habit: Habit, name: string) => habit.name.toLowerCase() === name.toLowerCase();
      const existing = all.filter((habit) => ideas.some((name) => same(habit, name)));
      const fresh = ideas.filter((name) => !all.some((habit) => same(habit, name)));
      openSheet({
        title: result.title,
        scope: result.scope,
        due: result.deadline ?? defaultDue(localDay()),
        lessons: matchLessons(result.title, latest.current.lessons).map((lesson) => lesson.id),
        // Такая привычка уже есть: отмечаем её, а не предлагаем вторую такую же.
        habitIds: existing.slice(0, 1).map((habit) => habit.id),
        newHabits: existing.length ? [] : fresh.slice(0, 1),
        ideas: fresh,
        note:
          (result.scope === "study" ? "Похоже на цель по учёбе. " : "Похоже на общую цель. ") +
          (result.deadline ? "Срок нашёл в тексте." : "Срока в тексте нет, поставил месяц."),
      });
    },
    [openSheet],
  );

  const editGoal = (goal: Goal) => {
    setSheet({
      id: goal.id,
      title: goal.title,
      scope: goal.scope,
      due: goal.due,
      tone: goal.tone,
      lessons: goal.lessons,
      habitIds: habitsOf(goal).map((habit) => habit.id),
      newHabits: [],
      ideas: [],
      note: "",
      progress: goal.progress,
    });
  };

  const saveDraft = async (draft: GoalDraft) => {
    const fields = {
      title: draft.title,
      scope: draft.scope,
      tone: draft.tone,
      dueDate: draft.due,
      lessons: draft.lessons,
    };
    const saved = draft.id ? await updateGoal(draft.id, fields) : await createGoal(fields);

    // Цель уже сохранена: сбой с привычками не должен выглядеть как сбой цели.
    const day = localDay();
    const wanted = new Set(draft.habitIds);
    const relinked = habits.filter((habit) =>
      wanted.has(habit.id) ? habit.goalId !== saved.id : habit.goalId === saved.id,
    );
    const taken = habits.map((habit) => habit.color);
    const results = await Promise.allSettled([
      ...relinked.map((habit) => updateHabit(habit.id, { goal: wanted.has(habit.id) ? saved.id : null }, day)),
      ...draft.newHabits.map((name) => {
        const color = nextHabitColor(taken);
        taken.push(color);
        return createHabit({ name, color, goal: saved.id }, day);
      }),
    ]);

    setFreshId(saved.id);
    mascot.hop(0.9);
    if (results.some((result) => result.status === "rejected")) {
      toast.error("Цель сохранена, но привычки привязались не все. Попробуй ещё раз в меню цели");
    } else {
      toast(draft.id ? "Цель обновлена" : "Цель сохранена");
    }
    void refresh();
    void refreshHabits();
  };

  // ── Действия с плашкой ──

  const chooseMain = (goal: Goal) => {
    withTransition(() => {
      setGoals((rows) => rows?.map((row) => ({ ...row, isMain: row.id === goal.id })) ?? rows);
    });
    mascot.hop(0.5);
    updateGoal(goal.id, { isMain: true }).catch(() => {
      toast.error("Не получилось выбрать главную цель");
      void refresh();
    });
  };

  /** Меняет цель сразу, пишет на сервер и предлагает вернуть как было. */
  const changeWithUndo = async (
    goal: Goal,
    fields: { status: string },
    message: string,
    failure: string,
  ) => {
    const restore = {
      status: goal.status,
      // Главной она была по праву: возвращаясь, забирает звезду обратно.
      ...(goal.isMain ? { isMain: true } : {}),
    };
    setGoals((rows) => rows?.map((row) => (row.id === goal.id ? { ...row, ...fields } : row)) ?? rows);
    try {
      await updateGoal(goal.id, fields);
      toast(message, {
        duration: UNDO_MS,
        action: {
          label: "Вернуть",
          onClick: () => {
            updateGoal(goal.id, restore)
              .catch(() => toast.error("Не получилось вернуть цель"))
              .finally(() => void refresh());
          },
        },
      });
    } catch {
      toast.error(failure);
    }
    await refresh();
  };

  const finishGoal = (goal: Goal) => {
    mascot.hop(1);
    mascot.react("happy", 1.5);
    void changeWithUndo(goal, { status: "done" }, "Цель достигнута", "Не получилось завершить цель");
  };

  const removeGoal = (goal: Goal) => {
    void changeWithUndo(goal, { status: "archived" }, "Цель удалена", "Не получилось удалить цель");
  };

  /** Предмет уходит со всем, что к нему привязано. Кэши, где он лежал, перечитываются как после удаления помощником. */
  const removeSubject = async (lesson: Lesson) => {
    await deleteSubjectGoal(lesson.id);
    setLessons((rows) => rows?.filter((row) => row.id !== lesson.id) ?? rows);
    subjectsChanged();
    topicsChanged();
    dataChanged("subjects");
    invalidatePlan();
    toast("Предмет удалён");
  };

  const reopenGoal = (goal: Goal) => {
    updateGoal(goal.id, { status: "active", ...(goal.savedProgress >= 100 ? { progress: SLIDER_MAX } : {}) })
      .catch(() => toast.error("Не получилось вернуть цель"))
      .finally(() => void refresh());
  };

  const commitProgress = (goal: Goal, value: number) => {
    if (value === Math.min(goal.progress, SLIDER_MAX)) {
      setMoving(null);
      return;
    }
    if (value > goal.progress) mascot.hop(0.42, "quiet");
    moveGoalProgress(goal.id, value)
      .then((fresh) => setGoals((rows) => rows?.map((row) => (row.id === fresh.id ? fresh : row)) ?? rows))
      .catch(() => toast.error("Не получилось сохранить прогресс"))
      .finally(() => setMoving((now) => (now?.id === goal.id && now.value === value ? null : now)));
  };

  // ── Строка «своими словами» ──

  const onAsk = (text: string) => {
    setOffer(null);
    void ask(text, (result) => {
      if (result.kind === "goal") {
        openFromText(result);
      } else if (result.kind === "habit") {
        setOffer({
          kind: "habit",
          text,
          name: result.name,
          goalId: suggestGoalFor(result.name, latest.current.goals.filter(isOpenGoal))?.id ?? null,
          schedule: result.schedule ?? EVERY_DAY,
        });
      } else if (result.kind === "question") {
        // Вопрос или просьба об уже записанном: это дело помощника, и второго нажатия тут не надо.
        prompt({ target: "book", text, send: true });
      } else {
        setOffer({ kind: result.kind, text });
      }
    });
  };

  useDataChanged("goals", () => void refresh());
  useDataChanged("subjects", () => void refreshLessons());
  useDataChanged("habits", () => void refreshHabits());

  const addHabit = async (name: string, goalId: string | null, schedule: HabitSchedule) => {
    setAdding(true);
    try {
      const color = nextHabitColor(habits.map((habit) => habit.color));
      const created = await createHabit({ name, color, goal: goalId, ...schedulePatch(schedule) }, localDay());
      setOffer(null);
      mascot.hop(0.7);
      router.push(`/dashboard/habits#h${created.id}`);
    } catch {
      toast.error("Не получилось добавить привычку. Попробуй ещё раз");
    } finally {
      setAdding(false);
    }
  };

  const goalMenu = (goal: Goal) => (
    <CardMenu label={`Меню цели: ${goal.title}`}>
      {(close) =>
        goal.status === "done" ? (
          <>
            <button
              className="gm-item"
              type="button"
              onClick={() => {
                close();
                reopenGoal(goal);
              }}
            >
              <Icon name="undo" />
              <span className="gm-text">Вернуть в работу</span>
            </button>
            <button
              className="gm-item"
              type="button"
              onClick={() => {
                close();
                removeGoal(goal);
              }}
            >
              <Icon name="x" />
              <span className="gm-text">Удалить</span>
            </button>
          </>
        ) : (
          <>
            {goal.manual ? (
              <ProgressSlider
                goal={goal}
                onMove={(value) => setMoving({ id: goal.id, value })}
                onCommit={(value) => commitProgress(goal, value)}
              />
            ) : (
              <p className="gm-note">Прогресс этой цели считается сам: по тому, что внутри неё.</p>
            )}
            <button
              className="gm-item"
              type="button"
              onClick={() => {
                close();
                editGoal(goal);
              }}
            >
              <Icon name="pencil" />
              <span className="gm-text">Изменить</span>
            </button>
            <button
              className="gm-item"
              type="button"
              onClick={() => {
                close();
                finishGoal(goal);
              }}
            >
              <Icon name="check" />
              <span className="gm-text">Цель достигнута</span>
            </button>
            <button
              className="gm-item"
              type="button"
              onClick={() => {
                close();
                removeGoal(goal);
              }}
            >
              <Icon name="x" />
              <span className="gm-text">Удалить</span>
            </button>
          </>
        )
      }
    </CardMenu>
  );

  const goalOptions = open.map((goal) => ({ id: goal.id, title: goal.title }));
  const showMain = main && fits(main);
  const nothingFits = goals !== null && open.length > 0 && !showMain && rest.length === 0;

  return (
    <div className="content view">
      <SubNav group="grow" />
      <header className="head">
        <h1 className="title">Цели</h1>
        <div className="head-tools">
          <div className="tabs" role="group" aria-label="Какие цели показать">
            {FILTERS.map((item) => (
              <button key={item.label} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <button className="btn btn-line" type="button" onClick={() => openSheet({})}>
            <Icon name="plus" />
            Новая цель
          </button>
        </div>
      </header>

      <AiLine
        placeholder="К чему хочешь прийти? Например: сдать физику на 9 к декабрю"
        short="К чему хочешь прийти?"
        label="Новая цель своими словами"
        onAsk={onAsk}
      />

      {thinking ? <AiThinking /> : null}

      {offer?.kind === "habit" ? (
        <HabitOffer
          name={offer.name}
          goalId={offer.goalId}
          goals={goalOptions}
          schedule={offer.schedule}
          onGoal={(goalId) => setOffer({ ...offer, goalId })}
          onSchedule={(schedule) => setOffer({ ...offer, schedule })}
          actions={[
            { label: adding ? "Добавляю…" : "Добавить привычку", main: true, disabled: adding, run: () => void addHabit(offer.name, offer.goalId, offer.schedule) },
            {
              label: "Всё равно цель",
              run: () => {
                setOffer(null);
                openFromText(parseGoal(offer.text));
              },
            },
          ]}
        />
      ) : null}
      {offer?.kind === "topics" ? (
        <AiOffer
          say="Это больше похоже на то, что ты уже изучил. Такое живёт в слабых темах."
          actions={[
            { label: "Открыть слабые темы", main: true, run: () => router.push("/dashboard/weaknesses") },
            {
              label: "Всё равно цель",
              run: () => {
                setOffer(null);
                openFromText(parseGoal(offer.text));
              },
            },
          ]}
        />
      ) : null}

      {goals === null && failed ? (
        <section className="gr-note card" role="alert">
          <h2>Цели не загрузились</h2>
          <p>Проверь связь и попробуй ещё раз.</p>
          <button className="btn btn-line" type="button" onClick={() => void refresh()}>
            Попробовать ещё раз
          </button>
        </section>
      ) : goals === null ? (
        <div className="gl-grid" aria-hidden="true">
          <div className="gr-skel" />
          <div className="gr-skel" />
        </div>
      ) : open.length === 0 && reached.length === 0 ? (
        <GoalsInvite onCreate={() => openSheet({})} />
      ) : (
        <>
          {showMain ? (
            <div className="plq-hero-wrap">
              <GoalHero
                key={main.id}
                goal={withMove(main)}
                today={today}
                fresh={main.id === freshId}
                next={nextFor(main)}
                links={<GoalLinks lessons={lessonsOf(main)} habits={habitsOf(main)} />}
                menu={goalMenu(main)}
              />
            </div>
          ) : null}
          {open.length === 0 ? (
            <section className="gr-note card">
              <h2>Все цели достигнуты</h2>
              <p>Напиши сверху, к чему хочешь прийти дальше.</p>
            </section>
          ) : null}
          {nothingFits ? <p className="small-note gr-none">Таких целей пока нет.</p> : null}
          {rest.length > 0 ? (
            <div className="gl-grid">
              {rest.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={withMove(goal)}
                  today={today}
                  fresh={goal.id === freshId}
                  onMain={() => chooseMain(goal)}
                  links={<GoalLinks lessons={lessonsOf(goal)} habits={habitsOf(goal)} />}
                  menu={goalMenu(goal)}
                />
              ))}
            </div>
          ) : null}
          {reached.some(fits) ? (
            <section className="gl-sec">
              <h2 className="sec">Достигнуто</h2>
              <ul className="plq-past">
                {reached.filter(fits).map((goal) => (
                  <li key={goal.id}>
                    <GoalDone goal={goal} menu={goalMenu(goal)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <section className="gl-sec">
        <div className="gl-sec-head">
          <h2 className="sec">Что изучаю</h2>
          <Link className="link" href="/dashboard/curriculum">
            Добавить предмет
          </Link>
        </div>
        {lessonsFailed ? (
          <p className="small-note" role="alert">
            Предметы не загрузились.{" "}
            <button className="link" type="button" onClick={() => void refreshLessons()}>
              Попробовать ещё раз
            </button>
          </p>
        ) : lessons === null ? (
          <p className="small-note" role="status">
            Загружаю предметы…
          </p>
        ) : lessons.length === 0 ? (
          <p className="small-note">Пока ничего. Добавь предмет, и здесь будет видно, сколько пройдено.</p>
        ) : (
          <ul className="pf-now">
            {lessons.map((lesson) => (
              <li key={lesson.id} className="pf-item">
                <Link className="pf-course card" href={lesson.href} data-attach={`Курс: ${lesson.subject}`}>
                  <span className={`book mini ${coverClass(lesson.subject)}`} aria-hidden="true" />
                  <span className="nm">
                    <b>{lesson.subject}</b>
                    <small>{lesson.line}</small>
                    {lesson.due ? <small>до {formatDay(lesson.due, today)}</small> : null}
                  </span>
                  {lesson.percent !== null ? (
                    <span
                      className="ring"
                      style={{ "--p": lesson.percent } as CSSProperties}
                      role="img"
                      aria-label={`Пройдено ${lesson.percent} ${plural(lesson.percent, "процент", "процента", "процентов")}`}
                    >
                      <span className="ring-arc" />
                      <span className="ring-head" />
                      <span className="ring-v">{lesson.percent}</span>
                    </span>
                  ) : (
                    <span />
                  )}
                </Link>
                <div className="pf-more">
                  <OverflowMenu label={`Меню предмета: ${lesson.subject}`} triggerClassName="icon-btn">
                    {() => (
                      <>
                        <p className="cur-menu-note">{deleteSubjectWarning(lesson.subject)}</p>
                        <ConfirmingAction
                          label="Удалить предмет"
                          confirm="Да, удалить"
                          onRun={() => removeSubject(lesson)}
                        />
                      </>
                    )}
                  </OverflowMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet ? (
        <GoalSheet
          key={sheet.id ?? "new"}
          seed={sheet}
          today={today}
          habits={habits}
          lessons={lessons}
          onClose={() => setSheet(null)}
          onSave={saveDraft}
        />
      ) : null}
    </div>
  );
}

/** Сколько пути пройдено. Слайм идёт по плашке прямо во время движения ползунка. */
function ProgressSlider({
  goal,
  onMove,
  onCommit,
}: {
  goal: Goal;
  onMove: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [value, setValue] = useState(Math.min(goal.progress, SLIDER_MAX));
  const moved = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const flush = useRef(() => {});
  flush.current = () => {
    window.clearTimeout(timer.current);
    if (!moved.current) return;
    moved.current = false;
    onCommit(value);
  };

  // Меню закрыли раньше, чем истекла пауза: значение всё равно записывается.
  useEffect(() => () => flush.current(), []);

  return (
    <label className="gm-range">
      <span className="gm-range-head">
        <span>Сколько пройдено</span>
        <b>{value}%</b>
      </span>
      <input
        type="range"
        min={0}
        max={SLIDER_MAX}
        step={5}
        value={value}
        style={{ "--v": `${(value / SLIDER_MAX) * 100}%` } as CSSProperties}
        onChange={(event) => {
          const next = Number(event.target.value);
          moved.current = true;
          setValue(next);
          onMove(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => flush.current(), 450);
        }}
      />
    </label>
  );
}

/** Первый заход: плашка без цели как приглашение. Слайм уже стоит у подножия. */
function GoalsInvite({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="plq plq-card gl gl-invite p-indigo">
      <RidgeArt id="invite" progress={0} />
      <h2 className="plq-name">Здесь будут твои цели</h2>
      <p className="plq-rules">Напиши сверху, к чему хочешь прийти, или заполни сам. Слайм пойдёт к вершине вместе с тобой.</p>
      <button className="btn btn-plq" type="button" onClick={onCreate}>
        Новая цель
      </button>
    </section>
  );
}
