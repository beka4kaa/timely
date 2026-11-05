"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BookOpen,
  ChevronDown,
  Copy,
  Ellipsis,
  MessageCircle,
  PanelLeft,
  RefreshCw,
  Search,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { LogoMark } from "./logo-mark";
import styles from "./chat-demo.module.css";

const TODAY = ["Второй закон Ньютона", "План на неделю", "Квадратные уравнения"];
const EARLIER = [
  "Подготовка к СОЧ по химии",
  "Эссе по «Капитанской дочке»",
  "Фотосинтез простыми словами",
  "Дроби без паники",
];

// Через сколько миллисекунд после предыдущей наступает каждая стадия диалога.
const SCRIPT = [0, 700, 900, 2300, 1100, 1900, 700, 1000];
const LAST_STAGE = SCRIPT.length;

/** Слова появляются по одному — как будто ответ печатается прямо сейчас. */
function stream(text: string) {
  const words = text.split(" ");
  return words.map((word, index) => (
    <span key={index} className={styles.word} style={{ "--i": index } as CSSProperties}>
      {word}
      {index < words.length - 1 ? " " : ""}
    </span>
  ));
}

function Typing() {
  return (
    <div className={styles.typing} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function ChatDemo() {
  const [stage, setStage] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(LAST_STAGE);
      return;
    }

    const timers: number[] = [];
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        let at = 0;
        SCRIPT.forEach((delay, index) => {
          at += delay;
          timers.push(window.setTimeout(() => setStage(index + 1), at));
        });
      },
      { threshold: 0.35 },
    );
    io.observe(root);
    return () => {
      io.disconnect();
      timers.forEach(window.clearTimeout);
    };
  }, []);

  // Новые сообщения подталкивают ленту вверх, как в настоящем чате.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || stage === 0) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [stage]);

  return (
    <div ref={rootRef} className={styles.frame}>
      <div className={styles.window}>
        <aside className={styles.sidebar} aria-hidden="true">
          <div className={styles.tools}>
            <Search size={15} />
            <SquarePen size={15} />
            <PanelLeft size={15} className={styles.toolEnd} />
          </div>
          <div className={styles.brand}>
            <LogoMark size={20} />
            Timely
          </div>
          <ul className={styles.nav}>
            <li className={styles.navActive}>
              <MessageCircle size={14} /> Тьютор
            </li>
            <li>
              <BookOpen size={14} /> Курс по книге <span className={styles.count}>2</span>
            </li>
          </ul>
          <p className={styles.group}>Сегодня</p>
          <ul className={styles.history}>
            {TODAY.map((title, index) => (
              <li key={title} className={index === 0 ? styles.historyActive : undefined}>
                {title}
                {index === 0 && <Ellipsis size={14} />}
              </li>
            ))}
          </ul>
          <p className={styles.group}>Ранее</p>
          <ul className={`${styles.history} ${styles.historyFaded}`}>
            {EARLIER.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </aside>

        <div className={styles.main}>
          <div className={styles.topbar} aria-hidden="true">
            <span className={styles.subject}>
              Физика, 9 класс <ChevronDown size={14} />
            </span>
            <span className={styles.source}>
              <BookOpen size={13} /> По учебнику
            </span>
          </div>

          <div
            ref={scrollRef}
            className={styles.thread}
            role="img"
            aria-label="Пример разговора с тьютором Timely про второй закон Ньютона"
          >
            {stage >= 1 && <p className={styles.user}>Не понимаю второй закон Ньютона</p>}

            {stage === 2 && <Typing />}

            {stage >= 3 && (
              <div className={styles.assistant}>
                <p>
                  <strong>{stream("Давай разберёмся на примере.")}</strong>
                </p>
                <p>
                  {stream(
                    "Толкни пустую тележку в магазине — она легко разгоняется. Нагрузи её покупками, и тот же толчок разгонит её заметно медленнее. Ускорение зависит от силы и от массы:",
                  )}
                </p>
                {stage >= 4 && (
                  <div className={styles.formulaRow}>
                    <div className={styles.formula}>
                      <span className={styles.formulaMain}>
                        a = <span className={styles.frac}><span>F</span><span>m</span></span>
                      </span>
                      <span className={styles.formulaCaption}>ускорение = сила / масса</span>
                    </div>
                    <span className={styles.cite}>
                      <BookOpen size={13} /> Физика 9, §10, с. 48
                    </span>
                  </div>
                )}
                {stage >= 5 && (
                  <>
                    <p>
                      {stream(
                        "Как думаешь: если массу увеличить вдвое, а силу оставить прежней, что станет с ускорением?",
                      )}
                    </p>
                    <div className={styles.actions} aria-hidden="true">
                      <Copy size={14} />
                      <ThumbsUp size={14} />
                      <ThumbsDown size={14} />
                      <Volume2 size={14} />
                      <RefreshCw size={14} />
                    </div>
                  </>
                )}
              </div>
            )}

            {stage >= 6 && <p className={styles.user}>Уменьшится в два раза?</p>}

            {stage === 7 && <Typing />}

            {stage >= 8 && (
              <div className={styles.assistant}>
                <p>
                  {stream(
                    "Именно! Теперь попробуй сам: тележку массой 20 кг толкают с силой 40 Н. Найди ускорение — если застрянешь, подскажу следующий шаг.",
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
