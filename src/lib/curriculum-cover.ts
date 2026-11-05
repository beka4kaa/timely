// Обложка-заглушка: цвет предмета, короткое название и автор.
//
// Настоящих обложек у загруженных файлов нет, а одинаковые серые прямоугольники
// на полке не отличить друг от друга. Поэтому цвет берётся от предмета: физика
// всегда одного цвета, а вторая книга того же предмета берёт соседний оттенок,
// чтобы на полке было видно, что это разные книги.
//
// Классы `b-*` и `cv-*` описаны в стилях (`pages.css`, `page-curriculum.css`):
// обложки это настоящие предметы, и им единственным на странице можно быть цветными.
//
// Без React и без запросов: чистые функции, проверяются тестом.

import { bookLabel } from "./book-label.ts";
import { cleanDocumentTitle } from "./curriculum-title.ts";

const SUBJECT_COVERS: { match: RegExp; covers: [string, string] }[] = [
  { match: /физик|механик|астроном|physics/i, covers: ["b-phys", "b-plum"] },
  { match: /алгебр|геометр|математ|math/i, covers: ["b-alg", "b-pale"] },
  { match: /русск|литератур/i, covers: ["b-rus", "cv-sky"] },
  { match: /хими|chem/i, covers: ["cv-teal", "cv-mint"] },
  { match: /биолог|природ|анатом|biolog/i, covers: ["cv-green", "cv-sage"] },
  { match: /истор|обществ|право|history/i, covers: ["cv-amber", "cv-sand"] },
  { match: /географ|geograph/i, covers: ["cv-ocean", "cv-sky"] },
  { match: /англ|english|ielts|toefl|немец|француз|казах|язык/i, covers: ["cv-coral", "cv-blush"] },
  { match: /информат|программ|python|machine learning|computer/i, covers: ["cv-slate", "cv-mist"] },
];

/** Предметам, которых нет в списке, цвет выбирается по названию, но всегда один и тот же. */
const OTHER_COVERS: [string, string][] = [
  ["cv-teal", "cv-mint"],
  ["cv-amber", "cv-sand"],
  ["cv-coral", "cv-blush"],
  ["cv-green", "cv-sage"],
  ["cv-ocean", "cv-sky"],
  ["b-plum", "b-pale"],
];

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) >>> 0;
  }
  return value;
}

/**
 * Класс обложки.
 *
 * `index` это место книги на полке предмета: у первой основной цвет предмета, у
 * остальных по очереди соседний и снова основной.
 */
export function coverClass(subject: string, index = 0): string {
  const name = (subject ?? "").trim();
  const found = SUBJECT_COVERS.find((item) => item.match.test(name));
  const pair = found ? found.covers : OTHER_COVERS[hash(name.toLowerCase()) % OTHER_COVERS.length];
  return pair[index % 2 === 0 ? 0 : 1];
}

/** Название книги для обложки: имя файла без меток файлообменников и разделителей. */
export function coverTitle(raw: string): string {
  return cleanDocumentTitle(bookLabel(raw));
}

const INITIAL = /^[A-Za-zА-Яа-яЁё]{1,2}\.$/;

/** «Кронгарт Б. А.» и «Б. А. Кронгарт» → «Кронгарт». Инициалы на обложке не помещаются. */
export function coverAuthor(authors: readonly string[] | null | undefined): string {
  const first = (authors ?? []).find((author) => author && author.trim());
  if (!first) return "";
  const words = first.replace(/\./g, ". ").trim().split(/\s+/);
  return words.find((word) => !INITIAL.test(word)) ?? first.trim();
}
