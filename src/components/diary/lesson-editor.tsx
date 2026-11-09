"use client";

// Правка одного урока шаблона: предмет или другой блок, время, длительность. На компьютере
// открывается у клетки, на телефоне снизу; содержимое одно.

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import type { BlockType } from "@/types/diary";

import {
  minutesOf,
  toClock,
  toMinutes,
  type SlotContent,
  type SlotDraft,
} from "./week-template";

export interface TemplateSubject {
  id: string;
  name: string;
  color: string;
}

export interface BlockOption {
  value: BlockType;
  label: string;
  custom: boolean;
}

const DURATIONS = [35, 40, 45, 60, 90];
const STEP = 5;

const normalized = (text: string) => text.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");

interface LessonEditorProps {
  slot: SlotDraft;
  subjects: TemplateSubject[];
  blocks: BlockOption[];
  shift: boolean;
  onShiftChange: (on: boolean) => void;
  onContent: (content: SlotContent) => void;
  onTimes: (start: string, end: string) => void;
  onCreateSubject: (name: string) => Promise<void>;
  onCreateBlock: (label: string) => void;
  onSwap: () => void;
  onRemove: () => void;
}

export function LessonEditor({
  slot,
  subjects,
  blocks,
  shift,
  onShiftChange,
  onContent,
  onTimes,
  onCreateSubject,
  onCreateBlock,
  onSwap,
  onRemove,
}: LessonEditorProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  // Текущий предмет может стоять в конце длинного списка: показываем его сразу.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, []);
  const wanted = normalized(query);
  const isLesson = slot.blockType === "lesson";

  const shownSubjects = useMemo(
    () => subjects.filter((subject) => !wanted || normalized(subject.name).includes(wanted)),
    [subjects, wanted],
  );
  const shownBlocks = useMemo(
    () => blocks.filter((block) => !wanted || normalized(block.label).includes(wanted)),
    [blocks, wanted],
  );
  const exact =
    subjects.some((subject) => normalized(subject.name) === wanted) ||
    blocks.some((block) => normalized(block.label) === wanted);

  const start = toMinutes(slot.startTime) ?? 0;
  const length = minutesOf(slot);

  /** Начало двигает урок целиком, конец меняет длительность. */
  const moveStart = (to: number) => {
    if (to < 0 || to + length >= 24 * 60) return;
    onTimes(toClock(to), toClock(to + length));
  };
  const moveEnd = (to: number) => {
    if (to <= start || to >= 24 * 60) return;
    onTimes(slot.startTime, toClock(to));
  };

  const createSubject = async () => {
    setCreating(true);
    try {
      await onCreateSubject(query.trim());
      setQuery("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ds-ed">
      <input
        className="ds-ed-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = shownSubjects[0];
          if (first) onContent({ subjectId: first.id, blockType: "lesson", label: "" });
          else if (wanted && !exact) void createSubject();
        }}
        placeholder="Найти или создать предмет"
        aria-label="Найти или создать предмет"
      />

      <div ref={list} className="ds-ed-list" role="listbox" aria-label="Что стоит на этом месте">
        {shownSubjects.map((subject) => {
          const on = isLesson && slot.subjectId === subject.id;
          return (
            <button
              key={subject.id}
              type="button"
              role="option"
              aria-selected={on}
              className="ds-opt"
              onClick={() => onContent({ subjectId: subject.id, blockType: "lesson", label: "" })}
            >
              <span className="ds-dot" style={{ background: subject.color }} />
              <span className="ds-opt-name">{subject.name}</span>
              {on ? <Icon name="check" /> : null}
            </button>
          );
        })}
        {wanted && !exact ? (
          <button type="button" className="ds-opt is-new" disabled={creating} onClick={() => void createSubject()}>
            <Icon name="plus" />
            <span className="ds-opt-name">{creating ? "Создаю…" : `Новый предмет «${query.trim()}»`}</span>
          </button>
        ) : null}
        {!subjects.length && !wanted ? <p className="ds-ed-note">Предметов пока нет. Напиши название выше.</p> : null}

        {shownBlocks.length || (wanted && !exact) ? <p className="ds-ed-h">Другое</p> : null}
        {shownBlocks.map((block) => {
          const on = slot.blockType === block.value;
          return (
            <button
              key={block.value}
              type="button"
              role="option"
              aria-selected={on}
              className="ds-opt"
              onClick={() => onContent({ subjectId: "", blockType: block.value, label: on ? slot.label : "" })}
            >
              <span className="ds-dot is-block" />
              <span className="ds-opt-name">{block.label}</span>
              {on ? <Icon name="check" /> : null}
            </button>
          );
        })}
        {wanted && !exact ? (
          <button
            type="button"
            className="ds-opt is-new"
            onClick={() => {
              onCreateBlock(query.trim());
              setQuery("");
            }}
          >
            <Icon name="plus" />
            <span className="ds-opt-name">Новый блок «{query.trim()}»</span>
          </button>
        ) : null}
      </div>

      {!isLesson ? (
        <label className="ds-ed-label">
          Подпись
          <input
            value={slot.label}
            onChange={(event) => onContent({ subjectId: "", blockType: slot.blockType, label: event.target.value })}
            placeholder="Например, классный час"
          />
        </label>
      ) : null}

      <p className="ds-ed-h">Время</p>
      <div className="ds-ed-times">
        <TimeField label="Начало" value={slot.startTime} onStep={(delta) => moveStart(start + delta)} onPick={moveStart} />
        <span className="ds-ed-to">до</span>
        <TimeField
          label="Конец"
          value={slot.endTime}
          onStep={(delta) => moveEnd(start + length + delta)}
          onPick={moveEnd}
        />
      </div>
      <div className="ds-ed-chips" role="group" aria-label="Длительность">
        {DURATIONS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`ds-chip${minutes === length ? " is-on" : ""}`}
            aria-pressed={minutes === length}
            onClick={() => moveEnd(start + minutes)}
          >
            {minutes} мин
          </button>
        ))}
      </div>
      <label className="ds-ed-shift">
        <button
          className="switch"
          type="button"
          role="switch"
          aria-checked={shift}
          aria-label="Сдвигать следующие уроки"
          onClick={() => onShiftChange(!shift)}
        />
        Сдвигать следующие уроки
      </label>

      <div className="ds-ed-acts">
        <button type="button" className="btn btn-text" onClick={onSwap}>
          Поменять местами
        </button>
        <button type="button" className="btn btn-text danger" onClick={onRemove}>
          Убрать урок
        </button>
      </div>
    </div>
  );
}

function TimeField({
  label,
  value,
  onStep,
  onPick,
}: {
  label: string;
  value: string;
  onStep: (delta: number) => void;
  onPick: (minutes: number) => void;
}) {
  return (
    <span className="ds-time">
      <input
        type="time"
        step={STEP * 60}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const minutes = toMinutes(event.target.value);
          if (minutes !== null) onPick(minutes);
        }}
      />
      <button type="button" aria-label={`${label} на ${STEP} минут раньше`} onClick={() => onStep(-STEP)}>
        −
      </button>
      <button type="button" aria-label={`${label} на ${STEP} минут позже`} onClick={() => onStep(STEP)}>
        +
      </button>
    </span>
  );
}
