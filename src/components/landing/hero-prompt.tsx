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
import type { HeroPromptCopy } from "./copy";
import styles from "./hero-prompt.module.css";

// Иконки подсказок по порядку: план, тема, задача, контрольная; потом «Ещё»: проверить, повторить.
const CHIP_ICONS: LucideIcon[] = [CalendarDays, Lightbulb, Sigma, Target];
const MORE_ICONS: LucideIcon[] = [CheckCheck, Repeat2];

export function HeroPrompt({ copy }: { copy: HeroPromptCopy }) {
  const { examples } = copy;
  const [value, setValue] = useState("");
  const [ghost, setGhost] = useState(examples[0]);
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
      const full = examples[example];
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
        example = (example + 1) % examples.length;
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
  }, [examples]);

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

  const chips = [
    ...copy.chips.map((chip, index) => ({ ...chip, icon: CHIP_ICONS[index] })),
    ...(more ? copy.more.map((chip, index) => ({ ...chip, icon: MORE_ICONS[index] })) : []),
  ];

  return (
    <div className={styles.wrap}>
      <form className={styles.box} onSubmit={submit}>
        <div className={styles.field}>
          <textarea
            ref={fieldRef}
            className={styles.textarea}
            value={value}
            rows={3}
            aria-label={copy.fieldLabel}
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
          <span className={styles.hint}>{copy.hint}</span>
          <button type="submit" className={styles.send} aria-label={copy.sendLabel}>
            <ArrowUp size={19} strokeWidth={2.2} />
          </button>
        </div>
      </form>

      <div className={styles.chips}>
        {chips.map(({ icon: Icon, label, prompt }, index) => (
          <button
            key={label}
            type="button"
            className={`${styles.chip} ${index >= copy.chips.length ? styles.chipNew : ""}`}
            style={{ "--i": index - copy.chips.length } as CSSProperties}
            onClick={() => fill(prompt)}
          >
            <Icon size={16} strokeWidth={1.8} />
            {label}
          </button>
        ))}
        {!more && (
          <button type="button" className={styles.chip} onClick={() => setMore(true)}>
            {copy.moreLabel}
          </button>
        )}
      </div>
    </div>
  );
}
