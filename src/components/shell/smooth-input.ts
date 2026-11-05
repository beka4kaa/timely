"use client";

// Ввод: настоящее поле остаётся, его текст прозрачный, а видна копия поверх.
// Новые буквы проявляются у каретки, сама каретка скользит.
//
// Поле должно лежать в своём `<span className="ti-host">`. Сам узел поля не двигаем:
// React хранит ссылку на родителя и упал бы при размонтировании.

import { useEffect, type RefObject } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;

function attachSmoothInput(field: Field, wrap: HTMLElement): () => void {
  const area = field instanceof HTMLTextAreaElement;
  wrap.classList.add("ti");
  wrap.classList.toggle("ti-area", area);

  const mirror = document.createElement("span");
  mirror.className = "ti-mirror";
  mirror.setAttribute("aria-hidden", "true");
  const line = document.createElement("span");
  line.className = "ti-line";
  const caret = document.createElement("i");
  caret.className = "ti-caret";
  mirror.appendChild(line);
  mirror.appendChild(caret);
  wrap.appendChild(mirror);

  let chars: string[] = [];
  let idle: ReturnType<typeof setTimeout> | undefined;

  function placeCaret() {
    const pos = Array.from(field.value.slice(0, field.selectionStart ?? 0)).length;
    const before = line.children[pos - 1] as HTMLElement | undefined;
    let x = 0;
    let y = 0;
    if (before?.textContent === "\n") {
      // Перевод строки: каретка уже на следующей.
      y = before.offsetTop + before.offsetHeight;
    } else if (before) {
      // У пустого поля каретка стоит чуть левее подсказки, чтобы не наезжать на первую букву.
      x = before.offsetLeft + before.offsetWidth + (area ? 1 : 3);
      y = before.offsetTop;
    }
    const scrollX = field.scrollLeft;
    const scrollY = field.scrollTop;
    line.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
    caret.style.transform = `translate(${x - scrollX}px, ${y - scrollY}px)`;
    wrap.classList.toggle("has-sel", field.selectionStart !== field.selectionEnd);
    wrap.classList.add("typing");
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => wrap.classList.remove("typing"), 520);
  }

  function sync(animate: boolean) {
    const next = Array.from(field.value);
    let a = 0;
    while (a < chars.length && a < next.length && chars[a] === next[a]) a++;
    let b = 0;
    while (b < chars.length - a && b < next.length - a && chars[chars.length - 1 - b] === next[next.length - 1 - b]) {
      b++;
    }
    for (let i = chars.length - b - 1; i >= a; i--) line.removeChild(line.children[i]);
    const anchor = line.children[a] ?? null;
    const added = next.length - b - a;
    for (let j = 0; j < added; j++) {
      const ch = document.createElement("span");
      ch.className = animate ? "ch in" : "ch";
      ch.textContent = next[a + j];
      if (animate && added > 1) ch.style.animationDelay = `${Math.min(j * 15, 300)}ms`;
      line.insertBefore(ch, anchor);
    }
    chars = next;
    placeCaret();
  }

  const onInput = () => {
    sync(true);
    requestAnimationFrame(placeCaret);
  };
  const onSelection = () => {
    if (document.activeElement === field) placeCaret();
  };
  const onAnimationEnd = (event: Event) => {
    const target = event.target as HTMLElement;
    target.classList.remove("in");
    target.style.animationDelay = "";
  };
  const cursorEvents = ["keyup", "click", "select", "focus", "scroll"];
  field.addEventListener("input", onInput);
  for (const name of cursorEvents) field.addEventListener(name, placeCaret);
  document.addEventListener("selectionchange", onSelection);
  line.addEventListener("animationend", onAnimationEnd);

  // React выставляет значение мимо события input: черновик извне, очистка после отправки.
  let frame = 0;
  const watch = () => {
    if (field.value !== chars.join("")) sync(false);
    frame = requestAnimationFrame(watch);
  };
  frame = requestAnimationFrame(watch);

  sync(false);
  // Ширина букв известна только после загрузки шрифта.
  void document.fonts?.ready.then(placeCaret);

  return () => {
    cancelAnimationFrame(frame);
    if (idle) clearTimeout(idle);
    field.removeEventListener("input", onInput);
    for (const name of cursorEvents) field.removeEventListener(name, placeCaret);
    document.removeEventListener("selectionchange", onSelection);
    mirror.remove();
    wrap.classList.remove("ti", "ti-area", "typing", "has-sel");
  };
}

/** Подключает плавный ввод к полю. При «меньше движения» поле остаётся обычным. */
export function useSmoothInput(ref: RefObject<Field | null>, enabled = true): void {
  useEffect(() => {
    const field = ref.current;
    const wrap = field?.parentElement;
    if (!field || !wrap || !enabled) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    return attachSmoothInput(field, wrap);
  }, [ref, enabled]);
}
