"use client";

// Название сессии: пиши что угодно или выбирай занятие из сегодняшнего плана.

import { useEffect, useMemo, useRef, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { useSmoothInput } from "@/components/shell/smooth-input";
import { cn } from "@/lib/utils";

export interface PlanOption {
  id: string;
  name: string;
  time: string;
}

interface SessionNameProps {
  value: string;
  onChange: (value: string) => void;
  options: PlanOption[];
}

const LIST_ID = "fp-list";

function normalized(text: string): string {
  return text.trim().toLocaleLowerCase("ru");
}

export function SessionName({ value, onChange, options }: SessionNameProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  useSmoothInput(inputRef);

  const matched = useMemo(
    () => options.find((option) => normalized(option.name) === normalized(value)) ?? null,
    [options, value],
  );

  // Название уже совпало с планом: показываем весь план, это выбор, а не поиск.
  const shown = useMemo(() => {
    const query = matched ? "" : normalized(value);
    return query ? options.filter((option) => normalized(option.name).includes(query)) : options;
  }, [options, value, matched]);

  const expanded = open && shown.length > 0;

  useEffect(() => {
    setActiveId(null);
  }, [value, open]);

  const choose = (option: PlanOption) => {
    onChange(option.name);
    setOpen(false);
    inputRef.current?.blur();
    mascot.hop(0.42, "quiet");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!shown.length) return;
      const at = shown.findIndex((option) => option.id === activeId);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = at === -1 && step === -1 ? shown.length - 1 : (at + step + shown.length) % shown.length;
      setActiveId(shown[next].id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = shown.find((option) => option.id === activeId);
      if (active) choose(active);
      else inputRef.current?.blur();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="fp-name-wrap">
      <label className="fp-name glass">
        <span className={cn("fp-dot", !matched && "none")} aria-hidden="true" />
        <span className="ti-host">
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder="Над чем работаешь?"
            aria-label="Название сессии"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={activeId ? `${LIST_ID}-${activeId}` : undefined}
            autoComplete="off"
            maxLength={120}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
        </span>
        {matched ? <span className="fp-link">из плана</span> : null}
      </label>
      <div
        className={cn("fp-list", !expanded && "is-off")}
        id={LIST_ID}
        role="listbox"
        aria-label="Занятия из плана"
        // Нажатие на вариант не должно снимать фокус с поля раньше времени.
        onMouseDown={(event) => event.preventDefault()}
      >
        {shown.map((option) => (
          <button
            key={option.id}
            id={`${LIST_ID}-${option.id}`}
            className="fp-opt"
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={option.id === activeId}
            onClick={() => choose(option)}
          >
            <span>{option.name}</span>
            <small>{option.time}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
