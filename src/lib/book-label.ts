// Читаемое имя книги для показа.
//
// При загрузке названием становится имя файла, а файлы у учеников выглядят так:
//
//   _OceanofPDF.com_Hands-On_Machine_Learning_with_Scikit-Learn_and_PyTorch_-_Aurelien_Geron
//
// В цитатах это имя повторялось восемь раз подряд и занимало больше места, чем
// сам ответ.
//
// Чистится именно ОТОБРАЖЕНИЕ. Переименовывать `Document.title` в базе —
// отдельный разговор: то же имя показано в каталоге и в заголовке страницы, и
// менять его надо там, где оно создаётся при загрузке.

/** Метки файлообменников в начале имени. */
const SOURCE_PREFIX = /^[_\-\s]*(oceanofpdf\.com|libgen|z-lib(rary)?\.\w+|annas-archive)[_\-\s]*/i;
/** Технический хвост: расширение и идентификатор загрузки. */
const EXTENSION = /\.(pdf|epub|djvu|fb2|mobi)$/i;
const LEADING_ID = /^\d{6,}[_\-\s]+/;

/**
 * «_OceanofPDF.com_Hands-On_Machine_Learning_-_Aurelien_Geron»
 *   → «Hands-On Machine Learning - Aurelien Geron»
 *
 * Пустая или полностью служебная строка возвращает исходник: показать
 * «Источник» вместо названия хуже, чем показать некрасивое название.
 */
export function bookLabel(title: string): string {
  const original = (title ?? "").trim();
  if (!original) return "";

  let cleaned = original;
  cleaned = cleaned.replace(EXTENSION, "");
  cleaned = cleaned.replace(SOURCE_PREFIX, "");
  cleaned = cleaned.replace(LEADING_ID, "");
  // Подчёркивания в имени файла стоят вместо пробелов.
  cleaned = cleaned.replace(/_+/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned || original;
}

/** Короткая ссылка на место в книге: «§ 2, стр. 90». */
export function citationSpot(citation: {
  section_path: string;
  page_start: number;
  page_end: number;
}): string {
  const parts: string[] = [];
  if (citation.section_path) parts.push(citation.section_path);
  if (citation.page_start > 0) {
    // У EPUB страниц нет вовсе, и «стр. 0» вела бы в никуда.
    parts.push(
      citation.page_start === citation.page_end
        ? `стр. ${citation.page_start}`
        : `стр. ${citation.page_start}–${citation.page_end}`,
    );
  }
  return parts.join(", ");
}
