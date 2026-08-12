// Разбор формы добавления источника.
//
// Без React намеренно, как в `studyplan/schedule-setup.logic.ts`: проверка
// чисел и адресов — это место, где легко ошибиться молча, и её нужно гонять
// тестами без рендера.
//
// Единица работы у всех типов одна: сколько всего и сколько минут на одну.
// Планировщик не разбирает, вариант это, задача или занятие. Тип влияет
// только на подписи — на то, чтобы в интерфейсе не стояло «12 из 40».

import type { StudyMaterialDraft, StudyMaterialKind } from "@/lib/curriculum-api";

export interface SourceFormValues {
  kind: StudyMaterialKind;
  title: string;
  url: string;
  note: string;
  /** Сырые строки из полей ввода: разбор — задача этого модуля. */
  totalUnits: string;
  minutesPerUnit: string;
}

export type SourceFormField = keyof SourceFormValues;
export type SourceFormErrors = Partial<Record<SourceFormField, string>>;

export const SOURCE_KINDS: {
  kind: StudyMaterialKind;
  label: string;
  /** Чем именно считается объём — подсказка под полем «сколько всего». */
  unitsHint: string;
  example: string;
}[] = [
  {
    kind: "link",
    label: "Ссылка",
    unitsHint: "занятий",
    example: "Khan Academy · SAT Math",
  },
  {
    kind: "practice_set",
    label: "Тесты",
    unitsHint: "вариантов",
    example: "SAT Practice Tests",
  },
  {
    kind: "problem_set",
    label: "Задачник",
    unitsHint: "задач",
    example: "Сборник Сканави",
  },
  {
    kind: "custom",
    label: "Своё",
    unitsHint: "занятий",
    example: "Повторять слова из Anki",
  },
];

/** Верхние границы — защита от опечатки, а не от злого умысла. */
const MAX_UNITS = 5000;
const MAX_MINUTES_PER_UNIT = 600;
/** Больше двух тысяч часов по одному источнику — это почти наверняка ноль лишний. */
const MAX_TOTAL_MINUTES = 2000 * 60;

export const EMPTY_SOURCE_FORM: SourceFormValues = {
  kind: "link",
  title: "",
  url: "",
  note: "",
  totalUnits: "",
  minutesPerUnit: "",
};

export function unitsHint(kind: StudyMaterialKind): string {
  return SOURCE_KINDS.find((item) => item.kind === kind)?.unitsHint ?? "занятий";
}

export function kindLabel(kind: StudyMaterialKind): string {
  return SOURCE_KINDS.find((item) => item.kind === kind)?.label ?? "Источник";
}

/**
 * Нормализует адрес: человек копирует «khanacademy.org» без схемы, и требовать
 * от него дописать `https://` — работа, которую поле может сделать само.
 */
export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseCount(raw: string): number | null {
  const value = raw.trim().replace(",", ".");
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function prepareSource(
  values: SourceFormValues,
  goalId: string,
): { draft: StudyMaterialDraft } | { errors: SourceFormErrors } {
  const errors: SourceFormErrors = {};

  const title = values.title.trim();
  if (!title) errors.title = "Без названия источник не найти в списке.";
  else if (title.length > 400) errors.title = "Слишком длинное название.";

  let url = "";
  if (values.kind === "link") {
    const normalized = normalizeUrl(values.url);
    if (!normalized) errors.url = "Нужен адрес страницы.";
    else url = normalized;
  } else if (values.url.trim()) {
    // Адрес у не-ссылки не обязателен, но и выбрасывать его незачем.
    url = normalizeUrl(values.url) ?? "";
  }

  const totalUnits = parseCount(values.totalUnits);
  if (totalUnits === null) errors.totalUnits = "Укажи целое число, больше нуля.";
  else if (totalUnits > MAX_UNITS) errors.totalUnits = `Не больше ${MAX_UNITS}.`;

  const minutesPerUnit = parseCount(values.minutesPerUnit);
  if (minutesPerUnit === null) {
    errors.minutesPerUnit = "Укажи целое число минут, больше нуля.";
  } else if (minutesPerUnit > MAX_MINUTES_PER_UNIT) {
    errors.minutesPerUnit = `Не больше ${MAX_MINUTES_PER_UNIT} минут.`;
  }

  if (
    totalUnits !== null &&
    minutesPerUnit !== null &&
    totalUnits * minutesPerUnit > MAX_TOTAL_MINUTES
  ) {
    errors.totalUnits = "Вместе это больше двух тысяч часов — проверь числа.";
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    draft: {
      goalId,
      kind: values.kind,
      title,
      url,
      note: values.note.trim(),
      total_units: totalUnits as number,
      minutes_per_unit: minutesPerUnit as number,
      unit_label: unitsHint(values.kind),
    },
  };
}

/** «10 вариантов · 30 ч» — сводка формы до отправки. */
export function sourceSummary(values: SourceFormValues): string {
  const totalUnits = parseCount(values.totalUnits);
  const minutesPerUnit = parseCount(values.minutesPerUnit);
  if (totalUnits === null || minutesPerUnit === null) return "";

  const minutes = totalUnits * minutesPerUnit;
  const hours = Math.round(minutes / 6) / 10;
  const time = minutes < 60 ? `${minutes} мин` : `${hours} ч`;
  return `${totalUnits} ${unitsHint(values.kind)} · ${time}`;
}
