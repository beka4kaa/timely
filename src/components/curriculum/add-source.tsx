// Добавление источника к предмету.
//
// Книга загружается файлом и обрабатывается минутами; всё остальное — ссылка,
// набор practice-тестов, задачник, своя формулировка — вводится за полминуты и
// готово сразу. Поэтому это popover прямо в строке предмета, а не отдельный
// шаг мастера: мастер оправдан там, где системе нужно подумать.
//
// Разбор значений живёт в `add-source.logic.ts` — здесь только состояние полей.

"use client";

import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import {
  paperCaption,
  paperFocus,
  paperPrimaryButton,
  paperQuietButton,
} from "./paper";

const FIELD =
  `w-full rounded-[11px] bg-[#f2ede4] px-3 py-2 text-[13px] text-[#312c27] placeholder:text-[#a89f93] ${paperFocus}`;
const LABEL = `${paperCaption} mb-1 block`;
const ERROR = "mt-1 text-[11.5px] text-[#a35c48]";

export function AddSource({
  goalId,
  onAdded,
}: {
  goalId: string;
  onAdded: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<SourceFormValues>(EMPTY_SOURCE_FORM);
  const [errors, setErrors] = useState<SourceFormErrors>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SourceFormValues>(
    key: K,
    value: SourceFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const close = () => {
    setOpen(false);
    setValues(EMPTY_SOURCE_FORM);
    setErrors({});
    setFailure("");
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
      close();
    } catch (error) {
      // Отказ показывается на месте: форма с введёнными значениями полезнее
      // тоста, который закрывают не глядя.
      setFailure(
        error instanceof CurriculumApiError
          ? error.message
          : "Не удалось сохранить. Проверьте соединение.",
      );
    } finally {
      setBusy(false);
    }
  };

  const summary = sourceSummary(values);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <button type="button" className={`${paperQuietButton} px-3 py-1.5 text-[12.5px]`}>
          + Добавить источник
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[320px] rounded-[16px] border-0 bg-[#fbfaf7] p-4 shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <div className="flex gap-1">
          {SOURCE_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => set("kind", item.kind)}
              className={`flex-1 rounded-[10px] px-2 py-1.5 text-[12px] transition-colors ${paperFocus} ${
                values.kind === item.kind
                  ? "bg-[#8a5b24] text-[#fdf8ef]"
                  : "bg-[#f2ede4] text-[#6f675e] hover:bg-[#ebe4d8]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <label className={LABEL} htmlFor="source-title">
            Название
          </label>
          <input
            id="source-title"
            className={FIELD}
            value={values.title}
            placeholder={
              SOURCE_KINDS.find((item) => item.kind === values.kind)?.example
            }
            onChange={(event) => set("title", event.target.value)}
          />
          {errors.title ? <p className={ERROR}>{errors.title}</p> : null}
        </div>

        {values.kind === "link" ? (
          <div className="mt-3">
            <label className={LABEL} htmlFor="source-url">
              Адрес
            </label>
            <input
              id="source-url"
              className={FIELD}
              value={values.url}
              placeholder="khanacademy.org/sat"
              onChange={(event) => set("url", event.target.value)}
            />
            {errors.url ? <p className={ERROR}>{errors.url}</p> : null}
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          <div className="min-w-0 flex-1">
            <label className={LABEL} htmlFor="source-units">
              Сколько {unitsHint(values.kind)}
            </label>
            <input
              id="source-units"
              inputMode="numeric"
              className={FIELD}
              value={values.totalUnits}
              placeholder="10"
              onChange={(event) => set("totalUnits", event.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className={LABEL} htmlFor="source-minutes">
              Минут на одну
            </label>
            <input
              id="source-minutes"
              inputMode="numeric"
              className={FIELD}
              value={values.minutesPerUnit}
              placeholder="45"
              onChange={(event) => set("minutesPerUnit", event.target.value)}
            />
          </div>
        </div>
        {errors.totalUnits ? <p className={ERROR}>{errors.totalUnits}</p> : null}
        {errors.minutesPerUnit ? (
          <p className={ERROR}>{errors.minutesPerUnit}</p>
        ) : null}

        <div className="mt-3">
          <label className={LABEL} htmlFor="source-note">
            Что по нему делать
          </label>
          <input
            id="source-note"
            className={FIELD}
            value={values.note}
            placeholder="необязательно"
            onChange={(event) => set("note", event.target.value)}
          />
        </div>

        {failure ? <p className={ERROR}>{failure}</p> : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[12px] text-[#8d857b]">{summary}</span>
          <button
            type="button"
            className={paperPrimaryButton}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "…" : "Добавить"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
