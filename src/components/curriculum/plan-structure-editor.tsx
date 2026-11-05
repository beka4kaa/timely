// Ручная правка состава программы.
//
// Редактор намеренно скромный: переименовать, изменить длительность, убрать, переставить.
// Добавить тему нельзя: у новой темы неоткуда взяться ссылкам на страницы книги, а тема без
// источника неотличима от выдуманной.
//
// Правки копятся локально и уходят одним запросом. Причина не в экономии запросов: состав,
// порядок и прогноз обязаны меняться вместе, иначе ученик успеет увидеть программу, у которой
// сроки посчитаны по старому составу.
//
// Удаление здесь без подтверждения, в отличие от полки: пока не нажата «Сохранить», ничего не
// потеряно, и «Отмена» возвращает всё.

"use client";

import { ArrowDown } from "lucide-react";
import { useMemo, useState } from "react";

import { Icon } from "@/components/shell/icons";
import {
  type CoursePlan,
  type StructureModulePatch,
  updatePlanStructure,
} from "@/lib/curriculum-api";

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
      sum + module.topics.reduce((inner, topic) => inner + (topic.estimated_minutes || 0), 0),
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
      // Модули, оставшиеся без тем, не отправляем: пустой модуль это остаток от удаления, а не
      // осмысленная часть программы.
      const modules = draft.filter((module) => module.topics.length > 0);
      const result = await updatePlanStructure(plan.id, modules);
      onPlanChange(result.plan);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не получилось сохранить изменения.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="course-edit" aria-label="Правка состава">
      <div className="course-edit-head">
        <h2 className="sec">Состав программы</h2>
        <span className="muted num">
          Тем: {totalTopics}, часов: {Math.round(totalMinutes / 60)}
        </span>
        <button
          type="button"
          className="btn btn-text"
          onClick={() => setDraft(initial)}
          disabled={busy}
        >
          <Icon name="undo" />
          Вернуть как было
        </button>
      </div>

      {draft.map((module, moduleIndex) => (
        <section key={module.external_id} className="card course-sheet">
          <div className="edit-row is-module">
            <label className="field">
              <span className="sr-only">Название главы</span>
              <input
                value={module.title || ""}
                onChange={(event) => patchModule(moduleIndex, { title: event.target.value })}
              />
            </label>
            <OrderButtons
              noun="главу"
              onUp={() => setDraft((current) => move(current, moduleIndex, moduleIndex - 1))}
              onDown={() => setDraft((current) => move(current, moduleIndex, moduleIndex + 1))}
            />
          </div>

          {module.topics.length === 0 ? (
            <p className="muted">Все темы убраны, глава исчезнет при сохранении.</p>
          ) : null}

          {module.topics.map((topic, topicIndex) => (
            <div key={topic.external_id} className="edit-row">
              <label className="field">
                <span className="sr-only">Название темы</span>
                <input
                  value={topic.title || ""}
                  onChange={(event) =>
                    patchModule(moduleIndex, {
                      topics: module.topics.map((item, i) =>
                        i === topicIndex ? { ...item, title: event.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="field edit-min">
                <span className="sr-only">Минут на тему</span>
                <input
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
                              estimated_minutes: Math.max(0, Number(event.target.value) || 0),
                            }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <span className="muted">мин</span>
              <OrderButtons
                noun="тему"
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
                title="Убрать тему"
                className="icon-btn"
                onClick={() =>
                  patchModule(moduleIndex, {
                    topics: module.topics.filter((_, i) => i !== topicIndex),
                  })
                }
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
        </section>
      ))}

      {error ? (
        <p className="cur-err" role="alert">
          {error}
        </p>
      ) : null}
      {totalTopics === 0 ? (
        <p className="cur-err">В программе должна остаться хотя бы одна тема.</p>
      ) : null}

      <div className="cur-acts">
        <button
          type="button"
          className="btn btn-main"
          disabled={busy || totalTopics === 0}
          onClick={() => void save()}
        >
          {busy ? "Сохраняю…" : "Сохранить изменения"}
        </button>
        <button type="button" className="btn btn-text" disabled={busy} onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  );
}

function OrderButtons({
  noun,
  onUp,
  onDown,
}: {
  noun: string;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <span className="edit-order">
      <button type="button" aria-label={`Поднять ${noun}`} title="Выше" className="icon-btn" onClick={onUp}>
        <Icon name="arrow-up" />
      </button>
      <button type="button" aria-label={`Опустить ${noun}`} title="Ниже" className="icon-btn" onClick={onDown}>
        <ArrowDown className="i" />
      </button>
    </span>
  );
}
