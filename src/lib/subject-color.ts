// Цвет предмета на экране. У предмета без своего цвета стоит общий по умолчанию, и все точки
// слились бы в одну. Такой предмет получает цвет по названию, всегда один и тот же.

const DEFAULT_COLORS = new Set(["#8b5cf6", "#6366f1", "#64748b"]);
const PALETTE = [
  "#5b7cfa",
  "#e0803a",
  "#2fa37a",
  "#d4556b",
  "#3aa0b8",
  "#b5803c",
  "#8a63e8",
  "#5aa84e",
  "#c9568f",
  "#4f8ad1",
  "#3e9a8a",
  "#9aa13a",
];

export function subjectColor(name: string, color?: string | null): string {
  if (color && !DEFAULT_COLORS.has(color.toLowerCase())) return color;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
