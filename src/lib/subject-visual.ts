// Как выглядит предмет: значок и оттенок плашки.
//
// Предмет приходит строкой из трёх мест — дневника («Физика»), программы курса
// («Физика 9») и слабых тем, — и у каждого была своя раскраска: молния в
// зелёном в дневнике, сине-серый в плане. Здесь одно правило на всех: одна и
// та же физика выглядит одинаково везде, где её видит ученик.

export type SubjectTint = "pink" | "lilac" | "sky" | "mint";

export type SubjectGlyph =
  | { kind: "icon"; icon: SubjectIconKey }
  | { kind: "letters"; text: string };

export type SubjectIconKey =
  | "sigma"
  | "triangle"
  | "atom"
  | "flask"
  | "leaf"
  | "book"
  | "languages"
  | "landmark"
  | "globe"
  | "code"
  | "music"
  | "palette"
  | "dumbbell";

export interface SubjectVisual {
  tint: SubjectTint;
  glyph: SubjectGlyph;
}

const RULES: Array<[RegExp, SubjectVisual]> = [
  [/геометр|geometr/i, { tint: "sky", glyph: { kind: "icon", icon: "triangle" } }],
  [/алгебр|матем|algebra|math|calculus/i, { tint: "lilac", glyph: { kind: "icon", icon: "sigma" } }],
  [/физик|physic|механик/i, { tint: "pink", glyph: { kind: "icon", icon: "atom" } }],
  [/хими|chemi/i, { tint: "mint", glyph: { kind: "icon", icon: "flask" } }],
  [/биолог|biolog|естеств/i, { tint: "mint", glyph: { kind: "icon", icon: "leaf" } }],
  [/литерат|literat/i, { tint: "lilac", glyph: { kind: "icon", icon: "book" } }],
  [/русск/i, { tint: "pink", glyph: { kind: "letters", text: "Аа" } }],
  [/казах|қазақ/i, { tint: "mint", glyph: { kind: "letters", text: "Қ" } }],
  [/англ|english|немец|german|франц|french|иностр/i, { tint: "sky", glyph: { kind: "icon", icon: "languages" } }],
  [/истор|history|обществ/i, { tint: "sky", glyph: { kind: "icon", icon: "landmark" } }],
  [/географ|geograph/i, { tint: "mint", glyph: { kind: "icon", icon: "globe" } }],
  [/информат|програм|python|code|coding|computer/i, { tint: "sky", glyph: { kind: "icon", icon: "code" } }],
  [/музык|music/i, { tint: "lilac", glyph: { kind: "icon", icon: "music" } }],
  [/рисова|изо\b|art\b|худож/i, { tint: "pink", glyph: { kind: "icon", icon: "palette" } }],
  [/физкульт|физ-ра|физра|спорт|sport/i, { tint: "mint", glyph: { kind: "icon", icon: "dumbbell" } }],
];

const TINTS: SubjectTint[] = ["lilac", "pink", "sky", "mint"];

/** Нераспознанный предмет: первая буква и оттенок по имени, а не случайный. */
function fallback(name: string): SubjectVisual {
  const clean = name.trim();
  let hash = 0;
  for (let index = 0; index < clean.length; index += 1) {
    hash = (hash * 31 + clean.charCodeAt(index)) >>> 0;
  }
  const letter = clean.charAt(0).toUpperCase() || "?";
  return { tint: TINTS[hash % TINTS.length], glyph: { kind: "letters", text: letter } };
}

export function subjectVisual(name: string | null | undefined): SubjectVisual {
  const clean = (name ?? "").trim();
  for (const [pattern, visual] of RULES) {
    if (pattern.test(clean)) return visual;
  }
  return fallback(clean);
}
