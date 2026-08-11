// Где в книге идёт разговор: цитаты → засечки на корешке.
//
// Список «Механика, §5.2, стр. 292» уже стоит под каждым ответом, и повторять
// его в панели источников значило бы напечатать одно и то же дважды. Панель
// показывает другое — РАСПОЛОЖЕНИЕ: разговор весь про середину учебника, или
// скачет по всей книге, или упёрся в одну главу. Из списка это не видно, а из
// корешка с закладками видно сразу.
//
// Чистые функции: положение засечки считается из `page_start`, `page_end` и
// `page_count`, и все три приходят с сервера в любом состоянии — ноль страниц
// у EPUB, страница больше объёма у книги, перезалитой в другом издании.

export interface SpreadCitation {
  document_id: string;
  document_title: string;
  page_start: number;
  page_end: number;
}

export interface SpineMark {
  /** Первая страница отметки — она же подпись. */
  page: number;
  /** Последняя страница. Совпадает с первой у одностраничной цитаты. */
  pageEnd: number;
  /** Середина отметки на корешке, доля 0…1. */
  at: number;
  /** Какую долю корешка отметка занимает. У одной страницы близка к нулю. */
  span: number;
  /** Реплики, где эта страница цитировалась: по клику лента прокрутится туда. */
  turns: number[];
}

export interface BookSpine {
  documentId: string;
  /** Сырое название: чистит его `bookLabel` там, где показывает. */
  title: string;
  /** Объём книги. Ноль — неизвестен (EPUB, книга без разметки страниц). */
  pageCount: number;
  /** По какому числу страниц считались доли. Никогда не ноль. */
  scale: number;
  marks: SpineMark[];
  /** Сколько всего ссылок на эту книгу в разговоре. */
  citations: number;
}

interface TurnLike {
  citations?: SpreadCitation[];
}

/**
 * Собирает корешки книг по всему разговору.
 *
 * Накопительно, а не по последнему ответу: смысл картинки в том, куда зашёл
 * разговор целиком.
 *
 * Книги идут в порядке первого появления — так же, как их встречал ученик.
 */
export function buildSpines(
  turns: TurnLike[],
  pageCounts: Map<string, number> | Record<string, number> = {},
): BookSpine[] {
  const lookup =
    pageCounts instanceof Map
      ? pageCounts
      : new Map(Object.entries(pageCounts));

  interface Collected {
    title: string;
    citations: number;
    ranges: { page: number; pageEnd: number; turn: number }[];
  }
  const books = new Map<string, Collected>();
  // Порядок первого появления держим отдельным списком: перебирать сам `Map`
  // мешает `target: es5` в tsconfig.
  const order: string[] = [];

  turns.forEach((turn, index) => {
    for (const citation of turn.citations ?? []) {
      const id = citation.document_id;
      if (!id) continue;
      let book = books.get(id);
      if (!book) {
        book = { title: citation.document_title ?? "", citations: 0, ranges: [] };
        books.set(id, book);
        order.push(id);
      }
      book.citations += 1;
      // Страниц может не быть вовсе — у EPUB их нет. Такая цитата считается,
      // но засечки не получает: ставить её в начало корешка значило бы
      // утверждать, что разговор идёт про первую страницу.
      const page = Math.floor(citation.page_start);
      if (!Number.isFinite(page) || page <= 0) continue;
      const pageEnd = Math.max(page, Math.floor(citation.page_end) || page);
      book.ranges.push({ page, pageEnd, turn: index });
    }
  });

  return order.map((documentId) => {
    const book = books.get(documentId) as Collected;
    const pageCount = Math.max(0, Math.floor(lookup.get(documentId) ?? 0));
    const furthest = book.ranges.reduce(
      (max: number, range) => Math.max(max, range.pageEnd),
      0,
    );
    // Объём книги может быть неизвестен или меньше процитированной страницы
    // (перезалитое издание). Тогда масштабом становится самая дальняя цитата:
    // корешок всё равно честно показывает разброс, просто его длина — это то,
    // что мы про книгу знаем.
    const scale = Math.max(pageCount, furthest, 1);

    return {
      documentId,
      title: book.title,
      pageCount,
      scale,
      citations: book.citations,
      marks: mergeMarks(book.ranges, scale),
    };
  });
}

/**
 * Слипает соседние страницы в одну засечку.
 *
 * Восемь ссылок на страницы 292–294 — это одно место в книге, а не восемь.
 * Порознь они дали бы на корешке чёрную кляксу вместо закладки.
 */
function mergeMarks(
  ranges: { page: number; pageEnd: number; turn: number }[],
  scale: number,
): SpineMark[] {
  const sorted = [...ranges].sort((a, b) => a.page - b.page || a.pageEnd - b.pageEnd);
  const merged: { page: number; pageEnd: number; turns: number[] }[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    // `+ 1` — смежные страницы тоже одно место: 292 и 293 это разворот.
    if (last && range.page <= last.pageEnd + 1) {
      last.pageEnd = Math.max(last.pageEnd, range.pageEnd);
      if (!last.turns.includes(range.turn)) last.turns.push(range.turn);
      continue;
    }
    merged.push({ page: range.page, pageEnd: range.pageEnd, turns: [range.turn] });
  }

  return merged.map((mark) => {
    // Страницы считаются от единицы: первая занимает отрезок [0, 1/scale].
    const from = clamp((mark.page - 1) / scale);
    const to = clamp(mark.pageEnd / scale);
    return {
      page: mark.page,
      pageEnd: mark.pageEnd,
      at: (from + to) / 2,
      span: Math.max(0, to - from),
      turns: mark.turns,
    };
  });
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
