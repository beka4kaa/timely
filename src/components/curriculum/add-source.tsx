// Добавление источника к предмету.
//
// Книга загружается файлом и обрабатывается минутами; всё остальное (ссылка, набор
// practice-тестов, задачник, своя формулировка) вводится за полминуты и готово сразу.
// Поэтому это короткая форма в листе меню предмета, а не шаг мастера: мастер оправдан
// там, где системе нужно подумать.
//
// Разбор значений живёт в `add-source.logic.ts`, здесь только состояние полей.

"use client";

import { useState } from "react";

import { CurriculumApiError, createMaterial } from "@/lib/curriculum-api";

import {
  EMPTY_SOURCE_FORM,
  SOURCE_KINDS,
  type SourceFormErrors,
  type SourceFormValues,
  prepareSource,
  sourceSummary,
  unitsHint,
} from "./add-source.logic";

export function AddSourceForm({
  goalId,
  onAdded,
  onClose,
}: {
  goalId: string;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<SourceFormValues>(EMPTY_SOURCE_FORM);
  const [errors, setErrors] = useState<SourceFormErrors>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SourceFormValues>(key: K, value: SourceFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async () => {
    const result = prepareSource(values, goalId);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }

    setBusy(true);
    setFailure("");
    try {
      await createMaterial(result.draft);
      await onAdded();
      onClose();
    } catch (error) {
      // Отказ показывается на месте: форма с введёнными значениями полезнее тоста,
      // который закрывают не глядя.
      setFailure(
        error instanceof CurriculumApiError
          ? error.message
          : "Не получилось сохранить. Проверь интернет.",
      );
    } finally {
      setBusy(false);
    }
  };

  const summary = sourceSummary(values);

  return (
    <form
      className="cur-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="tabs" role="group" aria-label="Что добавить">
        {SOURCE_KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            aria-pressed={values.kind === item.kind}
            onClick={() => set("kind", item.kind)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="field">
        Название
        <input
          value={values.title}
          placeholder={SOURCE_KINDS.find((item) => item.kind === values.kind)?.example}
          aria-invalid={Boolean(errors.title)}
          onChange={(event) => set("title", event.target.value)}
        />
        {errors.title ? <span className="cur-err">{errors.title}</span> : null}
      </label>

      {values.kind === "link" ? (
        <label className="field">
          Адрес
          <input
            value={values.url}
            placeholder="khanacademy.org/sat"
            inputMode="url"
            aria-invalid={Boolean(errors.url)}
            onChange={(event) => set("url", event.target.value)}
          />
          {errors.url ? <span className="cur-err">{errors.url}</span> : null}
        </label>
      ) : null}

      <div className="cur-form-two">
        <label className="field">
          Сколько {unitsHint(values.kind)}
          <input
            inputMode="numeric"
            value={values.totalUnits}
            placeholder="10"
            aria-invalid={Boolean(errors.totalUnits)}
            onChange={(event) => set("totalUnits", event.target.value)}
          />
        </label>
        <label className="field">
          Минут на одну
          <input
            inputMode="numeric"
            value={values.minutesPerUnit}
            placeholder="45"
            aria-invalid={Boolean(errors.minutesPerUnit)}
            onChange={(event) => set("minutesPerUnit", event.target.value)}
          />
        </label>
      </div>
      {errors.totalUnits ? <p className="cur-err">{errors.totalUnits}</p> : null}
      {errors.minutesPerUnit ? <p className="cur-err">{errors.minutesPerUnit}</p> : null}

      <label className="field">
        Что по нему делать
        <input
          value={values.note}
          placeholder="необязательно"
          onChange={(event) => set("note", event.target.value)}
        />
      </label>

      {failure ? <p className="cur-err">{failure}</p> : null}

      <div className="cur-form-foot">
        <span className="muted">{summary}</span>
        <span className="cur-acts">
          <button type="button" className="btn btn-text" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-main" disabled={busy}>
            {busy ? "Сохраняю…" : "Добавить"}
          </button>
        </span>
      </div>
    </form>
  );
}
