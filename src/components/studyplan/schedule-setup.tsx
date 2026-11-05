// Пошаговая настройка расписания в мини-окне.
//
// Бэкенд владеет порядком вопросов и подписывает каждое состояние. Компонент
// лишь показывает варианты, нормализует разрешённые свободные ответы и создаёт
// предложение. Активировать его пользователь по-прежнему должен отдельно.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
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
      <SetupCard phase={phase} title="Настроим твою неделю">
        <p className="q-status">
          Ответь на несколько коротких вопросов. Сначала покажу черновик: в расписание
          ничего не попадёт без твоего подтверждения.
        </p>
        <div className="q-acts">
          <button className="btn btn-main" type="button" onClick={begin}>
            Настроить расписание
          </button>
          {onCancel ? <CancelButton onClick={cancel} /> : null}
        </div>
      </SetupCard>
    );
  }

  if (phase === "blocked") {
    const noPlans = errorCode === "no_active_course_plans";
    return (
      <SetupCard phase={phase} title={noPlans ? "Сначала нужна учебная программа" : "Нужен ещё один шаг"}>
        <p className="q-status">{error}</p>
        <div className="q-acts">
          {noPlans ? (
            <Link href="/dashboard/curriculum" className="btn btn-main">
              Создать программу
            </Link>
          ) : null}
          <button className="btn btn-text" type="button" onClick={begin}>
            Проверить снова
          </button>
          {onCancel ? <CancelButton onClick={cancel} /> : null}
        </div>
      </SetupCard>
    );
  }

  if (phase === "error") {
    return (
      <SetupCard phase={phase} title="Не удалось продолжить">
        <p className="q-status" role="alert">
          {error}
        </p>
        <div className="q-acts">
          <button className="btn btn-main" type="button" onClick={() => void loadStep(retryRef.current)}>
            Повторить
          </button>
          <button className="btn btn-text" type="button" onClick={begin}>
            Начать заново
          </button>
          {onCancel ? <CancelButton onClick={cancel} /> : null}
        </div>
      </SetupCard>
    );
  }

  if (phase === "created") {
    return (
      <SetupCard phase={phase} title="Черновик готов">
        <p className="q-status">Проверь занятия в календаре и подтверди расписание отдельной кнопкой.</p>
        {error ? (
          <p className="q-status" role="alert">
            {error}
          </p>
        ) : null}
      </SetupCard>
    );
  }

  const title = summary ? "Такой ритм подойдёт?" : question?.text ?? "Готовлю следующий вопрос…";

  return (
    <SetupCard phase={phase} title={title} step={step} totalSteps={totalSteps}>
      {notice ? <p className="q-cite">{notice}</p> : null}

      {phase === "loading" ? <p className="q-status shine">Подбираю следующий вопрос…</p> : null}

      {phase === "question" && question ? (
        <div className="ps-opts">
          {question.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="ps-opt"
              disabled={Boolean(selectedOption)}
              aria-pressed={selectedOption === option.id}
              onClick={() => answerQuestion(option.id, option.id, "option")}
            >
              {option.label}
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}

          {question.has_more ? (
            <Link href="/dashboard/curriculum" className="ps-opt is-quiet">
              Показать все программы
            </Link>
          ) : null}

          {allowOther && !otherOpen ? (
            <button
              type="button"
              className="ps-opt is-quiet"
              onClick={() => {
                setOtherOpen(true);
                setError("");
              }}
            >
              Другое, напишу сам
            </button>
          ) : null}

          {allowOther && otherOpen ? (
            <form
              className="ps-other"
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
              />
              <button className="send" type="submit" disabled={!otherValue.trim()} aria-label="Сохранить свой ответ">
                <Icon name="arrow-up" />
              </button>
            </form>
          ) : null}

          {error ? (
            <p className="q-cite" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {(phase === "summary" || phase === "creating") && summary ? (
        <>
          <ul className="q-diff">
            {scheduleSetupSummaryRows(summary).map((row) => (
              <li key={row.label}>
                <span className="nm">{row.label}</span>
                <span className="chg">
                  <b>{row.value}</b>
                </span>
              </li>
            ))}
          </ul>
          <p className="q-cite">Создам только черновик: ты проверишь занятия в календаре и подтвердишь их отдельно.</p>
          {error ? (
            <p className="q-status" role="alert">
              {error}
            </p>
          ) : null}
          <div className="q-acts">
            <button
              className="btn btn-main"
              type="button"
              disabled={phase === "creating"}
              onClick={() => void createProposal()}
            >
              {phase === "creating" ? "Создаю…" : "Показать в календаре"}
            </button>
            <button className="btn btn-text" type="button" disabled={phase === "creating"} onClick={begin}>
              Заново
            </button>
            {onCancel ? <CancelButton onClick={cancel} /> : null}
          </div>
        </>
      ) : null}

      {onCancel && phase !== "summary" && phase !== "creating" ? (
        <div className="q-acts">
          <CancelButton onClick={cancel} />
        </div>
      ) : null}
    </SetupCard>
  );
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-text" type="button" onClick={onClick}>
      Не сейчас
    </button>
  );
}

function SetupCard({
  phase,
  title,
  step,
  totalSteps,
  children,
}: {
  phase: SetupPhase;
  title: string;
  step?: number;
  totalSteps?: number;
  children: React.ReactNode;
}) {
  const activeStep = Math.min(Math.max(1, totalSteps ?? 1), Math.max(1, step ?? 1));

  return (
    <section
      className="ps-setup"
      data-state={phase}
      aria-busy={phase === "loading" || phase === "creating"}
    >
      {step && totalSteps ? (
        <p
          className="ps-step"
          role="progressbar"
          aria-label={`Шаг ${activeStep} из ${totalSteps}`}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={activeStep}
        >
          Шаг {activeStep} из {totalSteps}
        </p>
      ) : null}
      <h2 className="q-say">{title}</h2>
      {children}
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
