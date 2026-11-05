// Темп занятий и желаемый срок.
//
// Это единственная правка программы, которая не трогает состав тем, поэтому она не вызывает
// модель и доступна даже на подтверждённой программе: сколько вечеров в неделю у ученика, не
// то же самое, чему его учат.
//
// Форма раскрывается на месте, а не в модальном окне: она из трёх полей, и затемнять ради
// неё страницу значит прятать сам план, ради которого её и открыли.

"use client";

import { useState } from "react";

import { type CoursePlan, type LearningGoal, updatePlanPace } from "@/lib/curriculum-api";

export function PlanPaceForm({
  plan,
  goal,
  onPlanChange,
  onDeadlineChange,
  onClose,
}: {
  plan: CoursePlan;
  goal: LearningGoal | null;
  onPlanChange: (plan: CoursePlan) => void;
  onDeadlineChange: (date: string | null) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState(String(plan.recommended_sessions_per_week || 3));
  const [minutes, setMinutes] = useState(String(plan.recommended_session_minutes || 40));
  // В поле настоящий срок ученика, а не прогноз: иначе смена темпа молча
  // превращала бы прогноз в срок.
  const [finish, setFinish] = useState(goal?.desired_finish_date ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await updatePlanPace(plan.id, {
        sessions_per_week: Number(sessions),
        minutes_per_session: Number(minutes),
        // Пустое поле это «без срока», а не «не трогать»: если человек стёр дату руками,
        // он именно снял дедлайн.
        desired_finish_date: finish || null,
      });
      onPlanChange(result.plan);
      onDeadlineChange(finish || null);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не получилось сохранить темп.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card course-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>Темп и срок</h2>
      <div className="course-pace">
        <label className="field">
          Занятий в неделю
          <input
            type="number"
            min={1}
            max={7}
            required
            value={sessions}
            onChange={(event) => setSessions(event.target.value)}
          />
        </label>
        <label className="field">
          Минут за занятие
          <input
            type="number"
            min={10}
            max={240}
            step={5}
            required
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <label className="field">
          Хочу закончить к
          <input type="date" value={finish} onChange={(event) => setFinish(event.target.value)} />
        </label>
      </div>

      {error ? (
        <p className="cur-err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cur-acts">
        <button type="submit" className="btn btn-main" disabled={busy}>
          {busy ? "Пересчитываю…" : "Пересчитать"}
        </button>
        <button type="button" className="btn btn-text" disabled={busy} onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
