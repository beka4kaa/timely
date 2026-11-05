"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  CalendarDays,
  CheckCheck,
  Lightbulb,
  Repeat2,
  Sigma,
  Target,
  type LucideIcon,
} from "lucide-react";
import { appLink } from "./app-url";
import styles from "./hero-prompt.module.css";

const EXAMPLES = [
  "Объясни второй закон Ньютона на примере",
  "Составь план подготовки к СОЧ по алгебре",
  "Проверь моё решение задачи про скорость",
  "Что такое валентность? Объясни простыми словами",
];

type Chip = { icon: LucideIcon; label: string; prompt: string };

const CHIPS: Chip[] = [
  { icon: CalendarDays, label: "План на день", prompt: "Составь план на сегодня. Задали: " },
  { icon: Lightbulb, label: "Объяснить тему", prompt: "Объясни простыми словами тему " },
  { icon: Sigma, label: "Решить задачу", prompt: "Помоги разобраться с задачей: " },
  { icon: Target, label: "К контрольной", prompt: "Помоги подготовиться к контрольной по " },
];

const MORE: Chip[] = [
  { icon: CheckCheck, label: "Проверить решение", prompt: "Проверь моё решение: " },
  { icon: Repeat2, label: "Повторить тему", prompt: "Давай повторим тему " },
];

export function HeroPrompt() {
  const [value, setValue] = useState("");
  const [ghost, setGhost] = useState(EXAMPLES[0]);
  const [typing, setTyping] = useState(false);
  const [more, setMore] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Подсказка в пустом поле печатается сама: примеры сменяют друг друга.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let example = 0;
    let length = 0;
    let erasing = false;
    let timer = 0;

    const tick = () => {
      const full = EXAMPLES[example];
      if (!erasing) {
        length += 1;
        setGhost(full.slice(0, length));
        if (length >= full.length) {
          erasing = true;
          timer = window.setTimeout(tick, 2000);
          return;
        }
        timer = window.setTimeout(tick, 38 + Math.random() * 45);
        return;
      }
      length -= 2;
      if (length <= 0) {
        length = 0;
        erasing = false;
        example = (example + 1) % EXAMPLES.length;
        setGhost("");
        timer = window.setTimeout(tick, 420);
        return;
      }
      setGhost(full.slice(0, length));
      timer = window.setTimeout(tick, 16);
    };

    setTyping(true);
    setGhost("");
    timer = window.setTimeout(tick, 1400);
    return () => window.clearTimeout(timer);
  }, []);

  const resize = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 220)}px`;
  };

  const fill = (prompt: string) => {
    setValue(prompt);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(prompt.length, prompt.length);
      resize();
    });
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const question = value.trim();
    window.location.assign(
      question ? appLink(`/chat?q=${encodeURIComponent(question)}`) : appLink("/chat"),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const chips = more ? [...CHIPS, ...MORE] : CHIPS;

  return (
    <div className={styles.wrap}>
      <form className={styles.box} onSubmit={submit}>
        <div className={styles.field}>
          <textarea
            ref={fieldRef}
            className={styles.textarea}
            value={value}
            rows={3}
            aria-label="Вопрос для Timely"
            onChange={(event) => {
              setValue(event.target.value);
              resize();
            }}
            onKeyDown={onKeyDown}
          />
          {!value && (
            <span className={styles.ghost} aria-hidden="true">
              {ghost}
              {typing && <span className={styles.caret} />}
            </span>
          )}
        </div>
        <div className={styles.bar}>
          <span className={styles.hint}>Ответ откроется в Timely</span>
          <button type="submit" className={styles.send} aria-label="Спросить Timely">
            <ArrowUp size={19} strokeWidth={2.2} />
          </button>
        </div>
      </form>

      <div className={styles.chips}>
        {chips.map(({ icon: Icon, label, prompt }, index) => (
          <button
            key={label}
            type="button"
            className={`${styles.chip} ${index >= CHIPS.length ? styles.chipNew : ""}`}
            style={{ "--i": index - CHIPS.length } as CSSProperties}
            onClick={() => fill(prompt)}
          >
            <Icon size={16} strokeWidth={1.8} />
            {label}
          </button>
        ))}
        {!more && (
          <button type="button" className={styles.chip} onClick={() => setMore(true)}>
            Ещё
          </button>
        )}
      </div>
    </div>
  );
}
