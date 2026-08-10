// Ручная правка состава программы.
//
// Редактор намеренно скромный: переименовать, изменить длительность, убрать,
// переставить. Добавить тему нельзя — у новой темы неоткуда взяться ссылкам на
// страницы книги, а тема без источника неотличима от выдуманной.
//
// Правки копятся локально и уходят одним запросом. Причина не в экономии
// запросов: состав, порядок и прогноз обязаны меняться вместе, иначе ученик
// успеет увидеть программу, у которой сроки посчитаны по старому составу.
//
// Удаление здесь без подтверждения, в отличие от каталога: пока не нажата
// «Сохранить», ничего не потеряно, и «Отмена» возвращает всё.

"use client";

import { ArrowDown, ArrowUp, Loader2, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  type CoursePlan,
  type StructureModulePatch,
  updatePlanStructure,
} from "@/lib/curriculum-api";

import { paperButton, paperCaption, paperPrimaryButton, paperTile } from "./paper";

const FIELD =
  "w-full rounded-[10px] border border-[#ddd7cd] bg-[#fffdfa] px-3 py-1.5 text-[14px] text-[#3b352f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35";

function toDraft(plan: CoursePlan): StructureModulePatch[] {
  return plan.modules.map((module) => ({
    external_id: module.external_id,
    title: module.title,
    objective: module.objective,
    topics: module.topics.map((topic) => ({
      external_id: topic.external_id,
      title: topic.title,
      objective: topic.objective,
      estimated_minutes: topic.estimated_minutes,
    })),
  }));
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function PlanStructureEditor({
  plan,
  onPlanChange,
  onClose,
}: {
  plan: CoursePlan;
  onPlanChange: (plan: CoursePlan) => void;
  onClose: () => void;
}) {
  const initial = useMemo(() => toDraft(plan), [plan]);
  const [draft, setDraft] = useState<StructureModulePatch[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalTopics = draft.reduce((sum, module) => sum + module.topics.length, 0);
  const totalMinutes = draft.reduce(
    (sum, module) =>
      sum +
      module.topics.reduce(
        (inner, topic) => inner + (topic.estimated_minutes || 0),
        0,
      ),
    0,
  );

  const patchModule = (index: number, patch: Partial<StructureModulePatch>) =>
    setDraft((current) =>
      current.map((module, i) => (i === index ? { ...module, ...patch } : module)),
    );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Модули, оставшиеся без тем, не отправляем: пустой модуль — это остаток
      // от удаления, а не осмысленная часть программы.
      const modules = draft.filter((module) => module.topics.length > 0);
      const result = await updatePlanStructure(plan.id, modules);
      onPlanChange(result.plan);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить изменения.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-[#8d857b]">
          {totalTopics} тем · {Math.round(totalMinutes / 60)} ч
        </p>
        <button
          type="button"
          className={`${paperButton} !px-3 !py-1 !text-[12px]`}
          onClick={() => setDraft(initial)}
          disabled={busy}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Вернуть как было
        </button>
      </div>

      {draft.map((module, moduleIndex) => (
        <section key={module.external_id} className={`${paperTile} px-4 py-3`}>
          <div className="flex items-center gap-2">
            <input
              className={FIELD}
              value={module.title || ""}
              onChange={(event) =>
                patchModule(moduleIndex, { title: event.target.value })
              }
              aria-label="Название модуля"
            />
            <OrderButtons
              onUp={() =>
                setDraft((current) => move(current, moduleIndex, moduleIndex - 1))
              }
              onDown={() =>
                setDraft((current) => move(current, moduleIndex, moduleIndex + 1))
              }
            />
          </div>

          {module.topics.length === 0 ? (
            <p className="mt-2 text-[12px] text-[#9b9186]">
              Все темы убраны — модуль исчезнет при сохранении.
            </p>
          ) : null}

          <div className="mt-2 space-y-1.5">
            {module.topics.map((topic, topicIndex) => (
              <div
                key={topic.external_id}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  className={`${FIELD} flex-1 min-w-[180px]`}
                  value={topic.title || ""}
                  onChange={(event) =>
                    patchModule(moduleIndex, {
                      topics: module.topics.map((item, i) =>
                        i === topicIndex
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    })
                  }
                  aria-label="Название темы"
                />
                <label className="flex items-center gap-1.5">
                  <span className={paperCaption}>мин</span>
                  <input
                    className={`${FIELD} w-20`}
                    type="number"
                    min={0}
                    step={5}
                    value={topic.estimated_minutes ?? 0}
                    onChange={(event) =>
                      patchModule(moduleIndex, {
                        topics: module.topics.map((item, i) =>
                          i === topicIndex
                            ? {
                                ...item,
                                estimated_minutes: Math.max(
                                  0,
                                  Number(event.target.value) || 0,
                                ),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <OrderButtons
                  onUp={() =>
                    patchModule(moduleIndex, {
                      topics: move(module.topics, topicIndex, topicIndex - 1),
                    })
                  }
                  onDown={() =>
                    patchModule(moduleIndex, {
                      topics: move(module.topics, topicIndex, topicIndex + 1),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label="Убрать тему"
                  className={`${paperButton} !px-2 !py-1`}
                  onClick={() =>
                    patchModule(moduleIndex, {
                      topics: module.topics.filter((_, i) => i !== topicIndex),
                    })
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {error ? <p className="text-[12px] text-[#8c4b41]">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={paperPrimaryButton}
          disabled={busy || totalTopics === 0}
          onClick={() => void save()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Сохранить изменения
        </button>
        <button
          type="button"
          className={paperButton}
          disabled={busy}
          onClick={onClose}
        >
          Отмена
        </button>
        {totalTopics === 0 ? (
          <p className="w-full text-[12px] text-[#8c4b41]">
            В программе должна остаться хотя бы одна тема.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function OrderButtons({
  onUp,
  onDown,
}: {
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <span className="flex shrink-0 gap-1">
      <button
        type="button"
        aria-label="Выше"
        className={`${paperButton} !px-2 !py-1`}
        onClick={onUp}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Ниже"
        className={`${paperButton} !px-2 !py-1`}
        onClick={onDown}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
