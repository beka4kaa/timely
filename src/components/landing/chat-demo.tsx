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
import type { ChatDemoCopy } from "./copy";
import { LogoMark } from "./logo-mark";
import styles from "./chat-demo.module.css";

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

export function ChatDemo({ copy }: { copy: ChatDemoCopy }) {
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
              <MessageCircle size={14} /> {copy.tutor}
            </li>
            <li>
              <BookOpen size={14} /> {copy.course} <span className={styles.count}>2</span>
            </li>
          </ul>
          <p className={styles.group}>{copy.todayGroup}</p>
          <ul className={styles.history}>
            {copy.today.map((title, index) => (
              <li key={title} className={index === 0 ? styles.historyActive : undefined}>
                {title}
                {index === 0 && <Ellipsis size={14} />}
              </li>
            ))}
          </ul>
          <p className={styles.group}>{copy.earlierGroup}</p>
          <ul className={`${styles.history} ${styles.historyFaded}`}>
            {copy.earlier.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </aside>

        <div className={styles.main}>
          <div className={styles.topbar} aria-hidden="true">
            <span className={styles.subject}>
              {copy.subject} <ChevronDown size={14} />
            </span>
            <span className={styles.source}>
              <BookOpen size={13} /> {copy.source}
            </span>
          </div>

          <div
            ref={scrollRef}
            className={styles.thread}
            role="img"
            aria-label={copy.threadLabel}
          >
            {stage >= 1 && <p className={styles.user}>{copy.ask}</p>}

            {stage === 2 && <Typing />}

            {stage >= 3 && (
              <div className={styles.assistant}>
                <p>
                  <strong>{stream(copy.lead)}</strong>
                </p>
                <p>{stream(copy.explain)}</p>
                {stage >= 4 && (
                  <div className={styles.formulaRow}>
                    <div className={styles.formula}>
                      <span className={styles.formulaMain}>
                        a = <span className={styles.frac}><span>F</span><span>m</span></span>
                      </span>
                      <span className={styles.formulaCaption}>{copy.formulaCaption}</span>
                    </div>
                    <span className={styles.cite}>
                      <BookOpen size={13} /> {copy.cite}
                    </span>
                  </div>
                )}
                {stage >= 5 && (
                  <>
                    <p>{stream(copy.question)}</p>
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

            {stage >= 6 && <p className={styles.user}>{copy.reply}</p>}

            {stage === 7 && <Typing />}

            {stage >= 8 && (
              <div className={styles.assistant}>
                <p>{stream(copy.answer)}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
