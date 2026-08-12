// Пошаговая настройка первого расписания для правой rail-панели.
//
// Бэкенд владеет порядком вопросов и подписывает каждое состояние. Компонент
// лишь показывает варианты, нормализует разрешённые свободные ответы и создаёт
// предложение. Активировать его пользователь по-прежнему должен отдельно.

"use client";

import Link from "next/link";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  paperButton,
  paperFocus,
  paperPrimaryButton,
  paperTile,
} from "@/components/curriculum/paper";
import {
  StudyplanApiError,
  type ScheduleSetupCreatedResponse,
  type ScheduleSetupQuestion,
  type ScheduleSetupSummary,
  confirmScheduleSetup,
  continueScheduleSetup,
} from "@/lib/studyplan-api";

import {
  prepareScheduleSetupAnswer,
  scheduleSetupSummaryRows,
} from "./schedule-setup.logic";

type SetupPhase =
  | "intro"
  | "loading"
  | "question"
  | "summary"
  | "creating"
  | "created"
  | "blocked"
  | "error";

interface SetupRequest {
  sessionId?: string;
  answers: Record<string, string>;
}

export interface ScheduleSetupProps {
  timeZone: string;
  startDate: string;
  onCreated: (
    result: ScheduleSetupCreatedResponse,
  ) => Promise<void> | void;
  /** Другая вкладка уже создала план: закрыть setup и перечитать календарь. */
  onScheduleExists?: () => Promise<void> | void;
  /** Закрыть setup и вернуться к обычному чату. */
  onCancel?: () => void;
  /** `/start` уже является явным действием, поэтому rail запускает сразу. */
  autoStart?: boolean;
}

export function ScheduleSetup({
  timeZone,
  startDate,
  onCreated,
  onScheduleExists,
  onCancel,
  autoStart = true,
}: ScheduleSetupProps) {
  const [phase, setPhase] = useState<SetupPhase>(
    autoStart ? "loading" : "intro",
  );
  const [sessionId, setSessionId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [question, setQuestion] = useState<ScheduleSetupQuestion | null>(null);
  const [summary, setSummary] = useState<ScheduleSetupSummary | null>(null);
  const [step, setStep] = useState(1);
  const [totalSteps, setTotalSteps] = useState(4);
  const [allowOther, setAllowOther] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherValue, setOtherValue] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");

  const controllerRef = useRef<AbortController | null>(null);
  const requestNumberRef = useRef(0);
  const retryRef = useRef<SetupRequest>({ answers: {} });

  const loadStep = useCallback(
    async (request: SetupRequest) => {
      const requestNumber = ++requestNumberRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      retryRef.current = request;

      setPhase("loading");
      setError("");
      setErrorCode("");
      setNotice("");

      try {
        const response = await continueScheduleSetup({
          timezone: timeZone,
          startDate,
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          // Новая сессия всегда начинается с пустого снимка.
          answers: request.sessionId ? request.answers : {},
          signal: controller.signal,
        });
        if (requestNumberRef.current !== requestNumber) return;

        setSessionId(response.session_id);
        setAnswers(response.answers);
        setStep(Math.max(1, response.step ?? 1));
        setTotalSteps(Math.max(1, response.total_steps_hint ?? 4));
        setNotice(
          response.notice ||
            (response.fallback
              ? "Продолжим с базовыми настройками расписания."
              : ""),
        );
        setSelectedOption("");
        setOtherOpen(false);
        setOtherValue("");

        if (response.status === "question") {
          setQuestion(response.question);
          setSummary(null);
          setAllowOther(Boolean(response.allow_other));
          setPhase("question");
          return;
        }

        setQuestion(null);
        setSummary(response.summary);
        setAllowOther(false);
        setStep(response.total_steps_hint ?? response.step ?? 4);
        setPhase("summary");
      } catch (caught) {
        if (
          requestNumberRef.current !== requestNumber ||
          isAbortError(caught)
        ) {
          return;
        }
        const code = caught instanceof StudyplanApiError ? caught.code : "";
        if (code === "schedule_already_exists" && onScheduleExists) {
          await onScheduleExists();
          return;
        }
        setErrorCode(code);
        setError(
          caught instanceof Error
            ? caught.message
            : "Не удалось продолжить настройку.",
        );
        setPhase(
          caught instanceof StudyplanApiError && caught.status === 409
            ? "blocked"
            : "error",
        );
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [onScheduleExists, startDate, timeZone],
  );

  const begin = useCallback(() => {
    setSessionId("");
    setAnswers({});
    setQuestion(null);
    setSummary(null);
    setStep(1);
    setTotalSteps(4);
    void loadStep({ answers: {} });
  }, [loadStep]);

  useEffect(() => {
    if (autoStart) begin();
    return () => {
      requestNumberRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [autoStart, begin]);

  const cancel = useCallback(() => {
    requestNumberRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    onCancel?.();
  }, [onCancel]);

  const answerQuestion = useCallback(
    (rawValue: string, optionId: string, source: "option" | "other") => {
      if (!question || phase !== "question") return;
      const prepared = prepareScheduleSetupAnswer(question.id, rawValue, source);
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const nextAnswers = { ...answers, [question.id]: prepared.value };
      setSelectedOption(optionId);
      setError("");
      void loadStep({ sessionId, answers: nextAnswers });
    },
    [answers, loadStep, phase, question, sessionId],
  );

  const createProposal = useCallback(async () => {
    if (!sessionId || !summary || phase !== "summary") return;
    const requestNumber = ++requestNumberRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("creating");
    setError("");

    try {
      const result = await confirmScheduleSetup({
        sessionId,
        answers,
        signal: controller.signal,
      });
      if (requestNumberRef.current !== requestNumber) return;
      setPhase("created");
      try {
        await onCreated(result);
      } catch {
        if (requestNumberRef.current === requestNumber) {
          setError("Черновик создан. Если календарь не обновился, перезагрузи страницу.");
        }
      }
    } catch (caught) {
      if (
        requestNumberRef.current !== requestNumber ||
        isAbortError(caught)
      ) {
        return;
      }
      const code = caught instanceof StudyplanApiError ? caught.code : "";
      if (code === "schedule_already_exists" && onScheduleExists) {
        await onScheduleExists();
        return;
      }
      setErrorCode(code);
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось создать предложение расписания.",
      );
      // Итог остаётся видимым: подтверждение идемпотентно и его можно повторить.
      setPhase("summary");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [answers, onCreated, onScheduleExists, phase, sessionId, summary]);

  if (phase === "intro") {
    return (
      <SetupCard
        phase={phase}
        title="Настроим твою неделю"
        onCancel={onCancel ? cancel : undefined}
      >
        <p className="text-[12.5px] leading-relaxed text-[#7b7168]">
          Ответь на несколько коротких вопросов. Сначала покажем черновик —
          ничего не попадёт в расписание без твоего подтверждения.
        </p>
        <button
          type="button"
          className={`${paperPrimaryButton} mt-4 w-full`}
          onClick={begin}
        >
          Настроить расписание
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </SetupCard>
    );
  }

  if (phase === "blocked") {
    const noPlans = errorCode === "no_active_course_plans";
    return (
      <SetupCard
        phase={phase}
        title={noPlans ? "Сначала нужна учебная программа" : "Нужен ещё один шаг"}
        onCancel={onCancel ? cancel : undefined}
      >
        <p className="text-[12.5px] leading-relaxed text-[#7b7168]">{error}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {noPlans ? (
            <Link href="/dashboard/curriculum" className={paperPrimaryButton}>
              Создать программу
            </Link>
          ) : null}
          <button type="button" className={paperButton} onClick={begin}>
            Проверить снова
          </button>
        </div>
      </SetupCard>
    );
  }

  if (phase === "error") {
    return (
      <SetupCard
        phase={phase}
        title="Не удалось продолжить"
        onCancel={onCancel ? cancel : undefined}
      >
        <p className="text-[12.5px] leading-relaxed text-[#a2543a]" role="alert">
          {error}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={paperPrimaryButton}
            onClick={() => void loadStep(retryRef.current)}
          >
            Повторить
          </button>
          <button type="button" className={paperButton} onClick={begin}>
            Начать заново
          </button>
        </div>
      </SetupCard>
    );
  }

  if (phase === "created") {
    return (
      <SetupCard
        phase={phase}
        title="Черновик готов"
        onCancel={onCancel ? cancel : undefined}
      >
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[#5f584f]">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3973b8]" />
          Проверь занятия в календаре и подтверди расписание отдельной кнопкой.
        </p>
        {error ? (
          <p className="mt-3 text-[11.5px] text-[#a2543a]" role="alert">
            {error}
          </p>
        ) : null}
      </SetupCard>
    );
  }

  const title = summary
    ? "Такой ритм подойдёт?"
    : question?.text ?? "Готовлю следующий вопрос…";

  return (
    <SetupCard
      phase={phase}
      title={title}
      step={step}
      totalSteps={totalSteps}
      onCancel={onCancel ? cancel : undefined}
    >
      {notice ? (
        <p className="mb-3 rounded-[10px] bg-[#f1ede6] px-2.5 py-2 text-[10.5px] text-[#7c746a]">
          {notice}
        </p>
      ) : null}

      {phase === "loading" ? (
        <div className="flex min-h-24 items-center justify-center gap-2 text-[11px] text-[#8c857c]">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          Подбираю следующий вопрос…
        </div>
      ) : null}

      {phase === "question" && question ? (
        <div className="space-y-1.5">
          {question.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={Boolean(selectedOption)}
              aria-pressed={selectedOption === option.id}
              onClick={() => answerQuestion(option.id, option.id, "option")}
              className={`w-full rounded-[13px] border px-3 py-2.5 text-left outline-none transition-colors ${paperFocus} ${
                selectedOption === option.id
                  ? "border-[#8aaed8] bg-[#eef5fd] text-[#263d5a]"
                  : "border-[#ddd8d0] bg-white/60 text-[#514a42] hover:border-[#9bb8da] hover:bg-[#f5f9fe]"
              }`}
            >
              <span className="block font-serif text-[12px] font-semibold leading-tight">
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-1 block text-[10px] leading-snug text-[#938c83]">
                  {option.description}
                </span>
              ) : null}
            </button>
          ))}

          {question.has_more ? (
            <Link
              href="/dashboard/curriculum"
              className={`block w-full rounded-[12px] border border-dashed border-[#d5cfc6] px-3 py-2 text-[11px] text-[#837c73] transition-colors hover:border-[#9bb8da] hover:bg-[#f5f9fe] ${paperFocus}`}
            >
              Показать все программы
            </Link>
          ) : null}

          {allowOther && !otherOpen ? (
            <button
              type="button"
              onClick={() => {
                setOtherOpen(true);
                setError("");
              }}
              className={`w-full rounded-[12px] border border-dashed border-[#d5cfc6] px-3 py-2 text-left text-[11px] text-[#837c73] transition-colors hover:border-[#9bb8da] hover:bg-[#f5f9fe] ${paperFocus}`}
            >
              Другое — напишу сам
            </button>
          ) : null}

          {allowOther && otherOpen ? (
            <form
              className="flex gap-1.5 pt-1"
              onSubmit={(event) => {
                event.preventDefault();
                answerQuestion(otherValue, "other", "other");
              }}
            >
              <input
                autoFocus
                value={otherValue}
                inputMode={question.id === "session_minutes" ? "numeric" : "text"}
                maxLength={120}
                onChange={(event) => {
                  setOtherValue(event.target.value);
                  setError("");
                }}
                placeholder={customPlaceholder(question.id)}
                aria-label="Свой ответ"
                className="h-9 min-w-0 flex-1 rounded-[11px] border border-[#d8d2c9] bg-white/75 px-3 font-serif text-[12px] text-[#3c3630] outline-none placeholder:text-[#aaa49b] focus:border-[#6d9acc]"
              />
              <button
                type="submit"
                disabled={!otherValue.trim()}
                aria-label="Сохранить свой ответ"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#3973b8] text-white outline-none transition-colors hover:bg-[#2f64a3] focus-visible:ring-2 focus-visible:ring-[#78a4d5]/35 disabled:bg-[#ded9d1] disabled:text-[#aaa49b]"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : null}

          {error ? (
            <p className="pt-1 text-[10.5px] text-[#a2543a]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {(phase === "summary" || phase === "creating") && summary ? (
        <div>
          <p className="mb-3 text-[11px] leading-relaxed text-[#8f887f]">
            Создадим только черновик. Затем ты проверишь занятия в календаре и
            подтвердишь их отдельно.
          </p>
          <dl className="divide-y divide-[#e5e0d8] rounded-[13px] border border-[#ded8cf] bg-white/55 px-3">
            {scheduleSetupSummaryRows(summary).map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[72px_1fr] gap-2 py-2 text-[10.5px]"
              >
                <dt className="text-[#9a938a]">{row.label}</dt>
                <dd className="font-medium text-[#504940]">{row.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 flex items-start gap-2 text-[10.5px] leading-relaxed text-[#756e66]">
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#3973b8]" />
            Занятия появятся как предложение — их ещё можно проверить.
          </p>

          {error ? (
            <p className="mt-3 text-[10.5px] text-[#a2543a]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-[0.8fr_1.2fr] gap-1.5">
            <button
              type="button"
              disabled={phase === "creating"}
              className="h-9 rounded-[12px] border border-[#d7d1c8] bg-white/60 text-[11px] text-[#6f675e] outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-[#c9a16c]/25 disabled:opacity-50"
              onClick={begin}
            >
              Заново
            </button>
            <button
              type="button"
              disabled={phase === "creating"}
              className="flex h-9 items-center justify-center gap-1.5 rounded-[12px] bg-[#3973b8] text-[11px] font-medium text-white outline-none transition-colors hover:bg-[#2f64a3] focus-visible:ring-2 focus-visible:ring-[#78a4d5]/35 disabled:bg-[#78726b]"
              onClick={() => void createProposal()}
            >
              {phase === "creating" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  Создаю…
                </>
              ) : (
                <>
                  Показать в календаре
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}
    </SetupCard>
  );
}

function SetupCard({
  phase,
  title,
  step,
  totalSteps,
  onCancel,
  children,
}: {
  phase: SetupPhase;
  title: string;
  step?: number;
  totalSteps?: number;
  onCancel?: () => void;
  children: React.ReactNode;
}) {
  const activeStep = Math.min(
    Math.max(1, totalSteps ?? 1),
    Math.max(1, step ?? 1),
  );

  return (
    <section
      data-state={phase}
      aria-busy={phase === "loading" || phase === "creating"}
      aria-live="polite"
      className={`${paperTile} p-3.5 shadow-[0_8px_28px_rgba(67,57,45,0.05)]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#3973b8]">
            <span>Настройка недели</span>
            {step && totalSteps ? (
              <span
                className="font-sans normal-case tracking-normal text-[#999188]"
                role="progressbar"
                aria-label={`Шаг ${activeStep} из ${totalSteps}`}
                aria-valuemin={1}
                aria-valuemax={totalSteps}
                aria-valuenow={activeStep}
              >
                {activeStep}/{totalSteps}
              </span>
            ) : null}
          </div>
          <h2 className="mt-1.5 font-serif text-[18px] font-medium leading-[1.2] tracking-[-0.02em] text-[#39332d]">
            {title}
          </h2>
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Закрыть настройку"
            title="Закрыть настройку"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#999188] outline-none transition-colors hover:bg-[#f1ede6] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#78a4d5]/35"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function customPlaceholder(questionId: string): string {
  if (questionId === "weekdays") return "Например: пн, ср, пт";
  if (questionId === "start_time") return "Например: 18:30";
  if (questionId === "session_minutes") return "От 15 до 120 минут";
  return "Короткий ответ";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
