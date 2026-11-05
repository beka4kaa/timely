"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { ArrowUp, CalendarDays, Check, Menu, MessageCircle, Repeat2 } from "lucide-react";
import { LogoMark } from "./logo-mark";
import { watchScroll } from "./scroll-fx";
import { Slime } from "./slime";
import { scrollToY } from "./smooth-scroll";
import styles from "./use-cases.module.css";

// Где сцена помещается на экран целиком, она «прилипает», и вкладки
// переключает сама прокрутка. На телефонах — обычные вкладки.
const STAGE_QUERY =
  "(min-width: 900px) and (min-height: 680px) and (prefers-reduced-motion: no-preference)";

const CASES = [
  {
    id: "tutor",
    tab: "Тьютор",
    icon: MessageCircle,
    tint: styles.lilac,
    title: "Спроси и разберись",
    text: "Задай вопрос по теме или по задаче. Тьютор объяснит по твоему учебнику, приведёт пример и проверит, понял ли ты.",
    meta: "Ответ со ссылкой на страницу",
  },
  {
    id: "review",
    tab: "Повторение",
    icon: Repeat2,
    tint: styles.pink,
    title: "Помни, что изучил",
    text: "Напиши своими словами, что прошли на уроке. Timely сам заполнит темы и напомнит повторить, когда пора.",
    meta: "Напоминает слайм и уведомления",
  },
  {
    id: "plan",
    tab: "План",
    icon: CalendarDays,
    tint: styles.sky,
    title: "Один следующий шаг",
    text: "Программу по учебнику Timely раскладывает по дням и часам. Открываешь — и сразу видно, что делать сейчас.",
    meta: "Разложено по дням и часам",
  },
];

const PROMPT = "Помоги подготовиться к контрольной по алгебре в пятницу";

function PhoneVisual() {
  return (
    <div className={styles.phoneStage}>
      <div className={styles.phone}>
        <div className={styles.status}>9:41</div>
        <Menu size={18} className={styles.menu} />
        <div className={styles.phoneHero}>
          <LogoMark size={46} />
          <p>
            Твой AI-друг
            <br />
            для учёбы
          </p>
        </div>
      </div>
      <div className={styles.bubble}>
        <p>
          {PROMPT.split(" ").map((word, index) => (
            <span key={index} className={styles.word} style={{ "--i": index } as CSSProperties}>
              {word}{" "}
            </span>
          ))}
        </p>
        <span className={styles.bubbleSend}>
          <ArrowUp size={15} strokeWidth={2.2} />
        </span>
      </div>
    </div>
  );
}

const REVIEWS = [
  { time: "сегодня", task: "Квадратные неравенства", state: "now" },
  { time: "завтра", task: "Закон Ома", state: "next" },
  { time: "чт", task: "Метод интервалов", state: "next" },
  { time: "сб", task: "Законы Ньютона", state: "next" },
] as const;

function ReviewVisual() {
  return (
    <div className={styles.plan}>
      <p className={styles.planHead}>Пора повторить</p>
      <ol className={styles.planList}>
        {REVIEWS.map((row, index) => (
          <li
            key={row.task}
            className={`${styles.planRow} ${styles.reviewRow}`}
            data-state={row.state}
            style={{ "--i": index } as CSSProperties}
          >
            <time>{row.time}</time>
            <span className={styles.planTask}>{row.task}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const PLAN = [
  { time: "16:30", task: "Алгебра: номера 214–216", state: "done" },
  { time: "17:00", task: "Физика: разобрать условие задачи", state: "done" },
  { time: "17:10", task: "Решить две задачи на второй закон Ньютона", state: "now" },
  { time: "17:30", task: "Перерыв", state: "next" },
  { time: "17:35", task: "Повторить квадратные уравнения", state: "next" },
] as const;

function PlanVisual() {
  return (
    <div className={styles.plan}>
      <p className={styles.planHead}>Сегодня</p>
      <ol className={styles.planList}>
        {PLAN.map((row, index) => (
          <li
            key={row.time}
            className={styles.planRow}
            data-state={row.state}
            style={{ "--i": index } as CSSProperties}
          >
            <time>{row.time}</time>
            <span className={styles.planTask}>
              {row.state === "done" && <Check size={14} strokeWidth={2.4} />}
              {row.task}
            </span>
            {row.state === "now" && (
              <span className={styles.progress} aria-label="Идёт сейчас, осталось 12 минут">
                <span className={styles.progressBar} />
                <span className={styles.progressText}>осталось 12 мин</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function UseCases() {
  const [active, setActive] = useState(0);
  const [hops, setHops] = useState(0);
  const [staged, setStaged] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const show = useCallback((index: number) => {
    if (index === activeRef.current) return;
    activeRef.current = index;
    setActive(index);
    setHops((count) => count + 1);
  }, []);

  useEffect(() => {
    const query = window.matchMedia(STAGE_QUERY);
    const sync = () => setStaged(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Прогресс прилипшей сцены: какая вкладка сейчас и сколько от неё пройдено.
  useEffect(() => {
    const stage = stageRef.current;
    if (!staged || !stage) return;
    return watchScroll(stage, "stage", {
      onProgress: (p) => {
        const scaled = p * CASES.length;
        const index = Math.min(CASES.length - 1, Math.floor(scaled));
        stage.style.setProperty("--step", Math.min(scaled - index, 1).toFixed(3));
        show(index);
      },
    });
  }, [staged, show]);

  const select = (index: number) => {
    const stage = stageRef.current;
    if (staged && stage) {
      // В липкой сцене вкладку выбирает прокрутка — едем к середине её участка.
      const top = stage.getBoundingClientRect().top + window.scrollY;
      const range = stage.offsetHeight - window.innerHeight;
      scrollToY(top + range * ((index + 0.5) / CASES.length));
      return;
    }
    show(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (active + delta + CASES.length) % CASES.length;
    select(next);
    tabsRef.current[next]?.focus();
  };

  const current = CASES[active];
  const Icon = current.icon;

  return (
    <div ref={stageRef} className={staged ? styles.staged : undefined}>
      <div className={styles.root}>
        <div className={styles.tabs} role="tablist" aria-label="Как помогает Timely">
          {CASES.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                tabsRef.current[index] = node;
              }}
              id={`case-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls={`case-panel-${item.id}`}
              tabIndex={index === active ? 0 : -1}
              className={styles.tab}
              onClick={() => select(index)}
              onKeyDown={onKeyDown}
            >
              {item.tab}
            </button>
          ))}
        </div>

        <div
          id={`case-panel-${current.id}`}
          role="tabpanel"
          aria-labelledby={`case-tab-${current.id}`}
          className={styles.panel}
        >
          <div key={`text-${current.id}`} className={`${styles.card} ${styles.swap} ${current.tint}`}>
            <span className={`${styles.icon} ${current.tint}`}>
              <Icon size={18} strokeWidth={1.9} />
            </span>
            <h3 className={styles.title}>{current.title}</h3>
            <p className={styles.text}>{current.text}</p>
            <p className={styles.meta}>
              <span className={styles.dot} />
              {current.meta}
            </p>
          </div>

          <div className={`${styles.visual} ${current.tint}`}>
            <div className={styles.perch}>
              <Slime interactive hop={hops} label="Слайм Timely" />
            </div>
            <div key={`visual-${current.id}`} className={`${styles.visualInner} ${styles.swap}`}>
              {current.id === "tutor" && <PhoneVisual />}
              {current.id === "review" && <ReviewVisual />}
              {current.id === "plan" && <PlanVisual />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
