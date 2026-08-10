// Темп занятий и желаемый срок.
//
// Это единственная правка программы, которая не трогает состав тем, поэтому она
// не вызывает модель и доступна даже на подтверждённой программе: сколько
// вечеров в неделю у ученика — не то же самое, чему его учат.
//
// Форма раскрывается на месте, а не в модальном окне: она из трёх полей, и
// затемнять ради неё страницу — значит прятать сам план, ради которого её и
// открыли.

"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { useState } from "react";

import { type CoursePlan, updatePlanPace } from "@/lib/curriculum-api";

import { paperButton, paperCaption, paperTile } from "./paper";

const FIELD =
  "w-full rounded-[10px] border border-[#ddd7cd] bg-[#fffdfa] px-3 py-1.5 text-[14px] text-[#3b352f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35";

export function PlanPaceDialog({
  plan,
  onPlanChange,
}: {
  plan: CoursePlan;
  onPlanChange?: (plan: CoursePlan) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className={paperButton}
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="h-4 w-4" />
        Изменить темп
      </button>
    );
  }

  return (
    <PaceForm
      plan={plan}
      onPlanChange={onPlanChange}
      onClose={() => setOpen(false)}
    />
  );
}

function PaceForm({
  plan,
  onPlanChange,
  onClose,
}: {
  plan: CoursePlan;
  onPlanChange?: (plan: CoursePlan) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState(
    String(plan.recommended_sessions_per_week || 3),
  );
  const [minutes, setMinutes] = useState(
    String(plan.recommended_session_minutes || 40),
  );
  const [finish, setFinish] = useState(plan.forecast_finish_date || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await updatePlanPace(plan.id, {
        sessions_per_week: Number(sessions),
        minutes_per_session: Number(minutes),
        // Пустое поле — это «без срока», а не «не трогать»: если человек стёр
        // дату руками, он именно снял дедлайн.
        desired_finish_date: finish || null,
      });
      onPlanChange?.(result.plan);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить темп.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${paperTile} w-full space-y-3 px-4 py-3`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={paperCaption}>Занятий в неделю</span>
          <input
            className={FIELD}
            type="number"
            min={1}
            max={7}
            value={sessions}
            onChange={(event) => setSessions(event.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className={paperCaption}>Минут за занятие</span>
          <input
            className={FIELD}
            type="number"
            min={10}
            max={240}
            step={5}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className={paperCaption}>Хочу закончить к</span>
          <input
            className={FIELD}
            type="date"
            value={finish}
            onChange={(event) => setFinish(event.target.value)}
          />
        </label>
      </div>

      {error ? <p className="text-[12px] text-[#8c4b41]">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={paperButton}
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Пересчитать
        </button>
        <button
          type="button"
          className={paperButton}
          disabled={busy}
          onClick={onClose}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
