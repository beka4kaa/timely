// Первые два шага мастера: формулировка цели и уточнение.
//
// Про уверенность разбора. Провайдер-заглушка намеренно возвращает низкую уверенность,
// и когда модель не настроена, это её штатный ответ. Показывать такой разбор как факт
// нельзя, поэтому предмет и раздел всегда остаются редактируемыми полями, а не подписью.

"use client";

import { useEffect, useState } from "react";

import { BOOKS_ENABLED } from "@/config/features";
import type { Balance, Level } from "@/lib/curriculum-api";
import { msg, t } from "@/lib/i18n";
import type { LevelPair } from "@/lib/curriculum-levels";
import { useCurriculumStore } from "@/stores/curriculum-store";

import { LevelSpan } from "./level-span";
import { WizardHead } from "./wizard-head";

const EXAMPLES = [
  msg("Хочу научиться решать задачи по механике за 10 класс"),
  msg("Разобраться в линейной алгебре с нуля к сессии"),
  msg("Подтянуть органическую химию перед экзаменом"),
];

/** Короче этого по фразе не понять, что учить. */
const MIN_GOAL_LENGTH = 5;

export function GoalStep() {
  const submitGoal = useCurriculumStore((s) => s.submitGoal);
  const busy = useCurriculumStore((s) => s.busy);
  const [text, setText] = useState("");

  const length = text.trim().length;
  const canSubmit = length >= MIN_GOAL_LENGTH && !busy;

  return (
    <>
      <WizardHead title={t("Что хочешь выучить?")}>
        {BOOKS_ENABLED
          ? t("Напиши своими словами. Программу составлю по твоему учебнику, со ссылками на страницы.")
          : t("Напиши своими словами, что хочешь выучить. Предмет появится на полке.")}
      </WizardHead>

      <form
        className="card wz-sheet"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submitGoal(text.trim());
        }}
      >
        <label className="field">
          {t("Цель")}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("Например: хочу научиться решать задачи по механике")}
            rows={4}
            disabled={busy}
          />
        </label>
        {length > 0 && length < MIN_GOAL_LENGTH ? (
          <p className="cur-err" role="status">
            {t("Напиши чуть подробнее, чтобы было понятно, что учить.")}
          </p>
        ) : null}

        <div className="gs-chips" role="group" aria-label={t("Примеры")}>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="gs-chip"
              aria-pressed={text === t(example)}
              onClick={() => setText(t(example))}
              disabled={busy}
            >
              {t(example)}
            </button>
          ))}
        </div>

        <div className="cur-acts">
          <button type="submit" className="btn btn-main" disabled={!canSubmit}>
            {busy ? t("Разбираю цель…") : t("Продолжить", undefined, "мастер")}
          </button>
        </div>
      </form>
    </>
  );
}

const BALANCES: { value: Balance; label: string; hint: string }[] = [
  { value: "theory", label: msg("Больше теории"), hint: msg("разбор и формулировки") },
  { value: "balanced", label: msg("Поровну"), hint: msg("теория и задачи вместе") },
  { value: "practice", label: msg("Больше практики"), hint: msg("упор на задачи") },
];

/** Быстрые сроки. Расчёт даты это арифметика календаря, а не оценка прогноза. */
const QUICK_DEADLINES: { label: string; months: number }[] = [
  { label: msg("Через месяц"), months: 1 },
  { label: msg("Через три"), months: 3 },
  { label: msg("Через полгода"), months: 6 },
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
  // Пара, а не два состояния: инвариант «цель не ниже текущего» принадлежит паре, и два
  // независимых `useState` оставили бы невалидное состояние представимым.
  const [levels, setLevels] = useState<LevelPair>({
    current: "beginner" as Level,
    target: "school_confident" as Level,
  });
  const [balance, setBalance] = useState<Balance>("balanced");
  const [finishDate, setFinishDate] = useState("");
  // Модель могла не разобрать предмет: ругаться на пустое поле рано, пока не нажали «Всё верно».
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!goal) return;
    setSubject(goal.normalized_subject);
    setDirection(goal.normalized_direction);
    setLevels({ current: goal.current_level, target: goal.target_level });
    setBalance(goal.theory_practice_balance);
    setFinishDate(goal.desired_finish_date ?? "");
  }, [goal]);

  if (!goal) return null;

  const subjectMissing = tried && !subject.trim();

  const submit = () => {
    setTried(true);
    if (!subject.trim()) return;
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
  };

  return (
    <>
      <WizardHead title={t("Под кого строим курс")}>
        {t("Так я понял твою цель. Поправь, если что-то не так.")}
      </WizardHead>

      <form
        className="card wz-sheet"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) submit();
        }}
      >
        <blockquote className="wz-quote">{goal.original_text}</blockquote>

        <div className="cur-form-two">
          <label className="field">
            {t("Предмет")}
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t("Физика")}
              disabled={busy}
              aria-invalid={subjectMissing}
            />
            {subjectMissing ? <span className="cur-err">{t("Напиши предмет, без него курс не найти на полке.")}</span> : null}
          </label>
          <label className="field">
            {t("Раздел")}
            <input
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              placeholder={t("Механика")}
              disabled={busy}
            />
          </label>
        </div>

        <LevelSpan value={levels} onChange={setLevels} disabled={busy} />

        <div className="wz-block">
          <p className="wz-label" id="curriculum-balance-label">
            {t("Теория и практика")}
          </p>
          <div className="opts" role="group" aria-labelledby="curriculum-balance-label">
            {BALANCES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={balance === option.value}
                disabled={busy}
                onClick={() => setBalance(option.value)}
              >
                {t(option.label)}
                <span>{t(option.hint)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="wz-block">
          <p className="wz-label" id="curriculum-deadline-label">
            {t("Когда хочешь закончить")}
          </p>
          <div className="wz-deadline" role="group" aria-labelledby="curriculum-deadline-label">
            <label className="field wz-date">
              <span className="sr-only">{t("Дата")}</span>
              <input
                type="date"
                value={finishDate}
                min={todayIso()}
                onChange={(event) => setFinishDate(event.target.value)}
                disabled={busy}
              />
            </label>
            <div className="gs-chips">
              {QUICK_DEADLINES.map((quick) => {
                const iso = isoAfterMonths(quick.months);
                return (
                  <button
                    key={quick.months}
                    type="button"
                    className="gs-chip"
                    aria-pressed={finishDate === iso}
                    onClick={() => setFinishDate(iso)}
                    disabled={busy}
                  >
                    {t(quick.label)}
                  </button>
                );
              })}
              {finishDate ? (
                <button
                  type="button"
                  className="gs-chip"
                  aria-pressed="false"
                  onClick={() => setFinishDate("")}
                  disabled={busy}
                >
                  {t("Без срока")}
                </button>
              ) : null}
            </div>
          </div>
          <p className="wz-hint">
            {t("Это пожелание, а не обещание: успеваешь или нет, посчитаю, когда программа будет готова.")}
          </p>
        </div>

        <div className="cur-acts">
          <button type="submit" className="btn btn-main" disabled={busy}>
            {busy ? t("Сохраняю…") : t("Всё верно")}
          </button>
        </div>
      </form>
    </>
  );
}
