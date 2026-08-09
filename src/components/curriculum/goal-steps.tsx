// Первые два шага: формулировка цели и персонализация.
//
// Про уверенность нормализации. Провайдер-заглушка намеренно возвращает низкую
// уверенность, и когда модель не настроена — это её штатный ответ. Показывать
// такой разбор как факт нельзя, поэтому предмет и направление всегда остаются
// редактируемыми полями, а не подписью.

"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { Balance, Level } from "@/lib/curriculum-api";
import type { LevelPair } from "@/lib/curriculum-levels";
import { useCurriculumStore } from "@/stores/curriculum-store";
import { LevelSpan } from "./level-span";
import {
  paperCaption,
  paperFocus,
  paperPrimaryButton,
  paperStrip,
  paperTile,
} from "./paper";

const EXAMPLES = [
  "Хочу научиться решать задачи по механике за 10 класс",
  "Разобраться в линейной алгебре с нуля к сессии",
  "Подтянуть органическую химию перед экзаменом",
];

const fieldClass = `${paperFocus} w-full rounded-[12px] border border-[#ded7cd] bg-[#fffdfa] px-3.5 py-2.5 text-[14px] text-[#302b26] placeholder:text-[#b3a99c] disabled:opacity-55`;

export function GoalStep() {
  const submitGoal = useCurriculumStore((s) => s.submitGoal);
  const busy = useCurriculumStore((s) => s.busy);
  const [text, setText] = useState("");

  const canSubmit = text.trim().length >= 5 && !busy;

  return (
    <section className="space-y-5">
      <header className="space-y-1.5">
        <h2 className="font-serif text-[22px] tracking-[-0.025em] text-[#302b26]">
          Что вы хотите выучить?
        </h2>
        <p className="text-[13px] leading-6 text-[#7f776e]">
          Опишите своими словами. Программу построим по вашему учебнику, со
          ссылками на конкретные страницы.
        </p>
      </header>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Например: хочу научиться решать задачи по механике"
        rows={4}
        disabled={busy}
        className={`${fieldClass} resize-none leading-6`}
      />

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setText(example)}
            disabled={busy}
            className={`${paperFocus} rounded-full border border-[#e0d9cd] bg-[#fffdfa] px-3.5 py-1.5 text-[12px] text-[#7f776e] transition-colors hover:border-[#c7aa82] hover:text-[#312c27] disabled:opacity-50`}
          >
            {example}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void submitGoal(text.trim())}
        disabled={!canSubmit}
        className={paperPrimaryButton}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Продолжить
      </button>
    </section>
  );
}

const BALANCES: { value: Balance; label: string; hint: string }[] = [
  { value: "theory", label: "Больше теории", hint: "разбор и формулировки" },
  { value: "balanced", label: "Поровну", hint: "теория и задачи вместе" },
  { value: "practice", label: "Больше практики", hint: "упор на задачи" },
];

/** Быстрые сроки. Расчёт даты — арифметика календаря, а не оценка прогноза. */
const QUICK_DEADLINES: { label: string; months: number }[] = [
  { label: "Через месяц", months: 1 },
  { label: "Через три", months: 3 },
  { label: "Через полгода", months: 6 },
];

function isoAfterMonths(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function GoalConfirmStep() {
  const goal = useCurriculumStore((s) => s.goal);
  const saveGoalDetails = useCurriculumStore((s) => s.saveGoalDetails);
  const busy = useCurriculumStore((s) => s.busy);

  const [subject, setSubject] = useState("");
  const [direction, setDirection] = useState("");
  // Пара, а не два состояния: инвариант «цель не ниже текущего» принадлежит
  // паре, и два независимых `useState` оставили бы невалидное состояние
  // представимым.
  const [levels, setLevels] = useState<LevelPair>({
    current: "beginner" as Level,
    target: "school_confident" as Level,
  });
  const [balance, setBalance] = useState<Balance>("balanced");
  const [finishDate, setFinishDate] = useState("");

  useEffect(() => {
    if (!goal) return;
    setSubject(goal.normalized_subject);
    setDirection(goal.normalized_direction);
    setLevels({ current: goal.current_level, target: goal.target_level });
    setBalance(goal.theory_practice_balance);
    setFinishDate(goal.desired_finish_date ?? "");
  }, [goal]);

  if (!goal) return null;

  const submit = () =>
    void saveGoalDetails(
      {
        current_level: levels.current,
        target_level: levels.target,
        theory_practice_balance: balance,
        desired_finish_date: finishDate || null,
      },
      {
        normalized_subject: subject.trim(),
        normalized_direction: direction.trim(),
      },
    );

  return (
    <section className="space-y-5">
      <header className="space-y-1.5">
        <h2 className="font-serif text-[22px] tracking-[-0.025em] text-[#302b26]">
          Под кого строим курс
        </h2>
        <p className="text-[13px] leading-6 text-[#7f776e]">
          Так мы поняли вашу формулировку. Поправьте, если что-то не так.
        </p>
      </header>

      <blockquote className="border-l-2 border-[#dec9ab] py-1 pl-4 font-serif text-[15px] leading-6 text-[#5f584f]">
        {goal.original_text}
      </blockquote>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={paperCaption}>Предмет</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Физика"
            disabled={busy}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <label className="block">
          <span className={paperCaption}>Раздел</span>
          <input
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            placeholder="Механика"
            disabled={busy}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
      </div>

      <LevelSpan value={levels} onChange={setLevels} disabled={busy} />

      <div className={`${paperStrip} p-5`}>
        <p className={paperCaption} id="curriculum-balance-label">
          Теория и практика
        </p>
        <div
          role="radiogroup"
          aria-labelledby="curriculum-balance-label"
          className="mt-3 grid gap-2 sm:grid-cols-3"
        >
          {BALANCES.map((option) => {
            const selected = balance === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                onClick={() => setBalance(option.value)}
                className={`${paperTile} ${paperFocus} px-3.5 py-3 text-left transition-colors ${
                  selected
                    ? "border-[#dec9ab] bg-[#fffaf1]"
                    : "hover:border-[#d5cbbc]"
                }`}
              >
                <span
                  className={`block text-[13px] ${
                    selected ? "text-[#8a5b24]" : "text-[#4a443d]"
                  }`}
                >
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-[#9b9186]">
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${paperStrip} p-5`}>
        <p className={paperCaption}>Желаемый срок</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={finishDate}
            min={todayIso()}
            onChange={(event) => setFinishDate(event.target.value)}
            disabled={busy}
            aria-label="Желаемая дата завершения"
            className={`${fieldClass} w-auto`}
          />
          {QUICK_DEADLINES.map((quick) => (
            <button
              key={quick.months}
              type="button"
              onClick={() => setFinishDate(isoAfterMonths(quick.months))}
              disabled={busy}
              className={`${paperFocus} rounded-full border border-[#e0d9cd] bg-[#fffdfa] px-3.5 py-1.5 text-[12px] text-[#7f776e] transition-colors hover:border-[#c7aa82] hover:text-[#312c27] disabled:opacity-50`}
            >
              {quick.label}
            </button>
          ))}
          {finishDate && (
            <button
              type="button"
              onClick={() => setFinishDate("")}
              disabled={busy}
              className="text-[12px] text-[#9b9186] underline-offset-4 hover:underline"
            >
              Без срока
            </button>
          )}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-[#7f776e]">
          Это пожелание, а не обещание: успеваете вы или нет, посчитаем после
          того, как программа будет построена.
        </p>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={busy || !subject.trim()}
        className={paperPrimaryButton}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Всё верно
      </button>
    </section>
  );
}
