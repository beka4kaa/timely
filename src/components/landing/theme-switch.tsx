"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import styles from "./theme-switch.module.css";
import "./theme-transition.css";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

/**
 * Переключатель светлой и тёмной темы. Тема общая с приложением (next-themes)
 * и запоминается. Новая тема расходится кругом от кнопки — через View
 * Transitions; где их нет или просят меньше движения, смена мгновенная.
 */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Тема известна только в браузере: до монтирования не угадываем иконку.
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const next = dark ? "light" : "dark";
    const root = document.documentElement;

    // Класс ставим сами и сразу: next-themes применяет его в эффекте, а
    // снимок для перехода должен увидеть новую тему синхронно.
    const apply = () => {
      root.classList.remove("light", "dark");
      root.classList.add(next);
      root.style.colorScheme = next;
      setTheme(next);
    };

    const doc = document as ViewTransitionDocument;
    if (
      !doc.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      apply();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    root.classList.add("theme-transition");
    const transition = doc.startViewTransition(() => flushSync(apply));
    transition.ready
      .then(() => {
        root.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
          },
          {
            duration: 650,
            easing: "cubic-bezier(0.2, 0.75, 0.25, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      // Переход могут пропустить (например, вкладка скрыта) — тема уже сменилась.
      .catch(() => {});
    const cleanup = () => root.classList.remove("theme-transition");
    transition.finished.then(cleanup, cleanup);
  };

  const label = dark ? "Включить светлую тему" : "Включить тёмную тему";

  return (
    <button
      type="button"
      className={styles.switch}
      data-dark={dark ? "true" : undefined}
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <Sun className={styles.sun} size={18} strokeWidth={1.9} />
      <Moon className={styles.moon} size={17} strokeWidth={1.9} />
    </button>
  );
}
