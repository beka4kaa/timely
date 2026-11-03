// Общие классы «бумажного» диалекта раздела.
//
// В приложении три сложившихся визуальных языка, и curriculum должен говорить
// на том же, что шапка и помодоро: `CoffeePageShell`, Georgia, тёплые хексы.
// Стоковые `<Button>` и `bg-card/50` сюда не годятся — под тёплой темой они
// рендерятся коричневыми прямоугольниками, которые все выразительные страницы
// приложения намеренно обходят.
//
// Это строки утилит, а не CSS-классы: у них нет специфичности, поэтому они не
// схлопываются друг с другом на отступах между секциями.
//
// ПОВЕРХНОСТИ БЕЗ ОБВОДКИ. Раньше каждая поверхность несла три сигнала края
// сразу: обводку, заливку и тень. Внутри двадцати пикселей набегало три линии
// подряд — контур карточки, внутренний разделитель, контур плитки, — и на
// кремовом фоне это читалось как сетка, а не как бумага.
//
// Теперь край несёт заливка, глубину — мягкая тень, а линия осталась ровно
// там, где она разделяет (`paperRule`), а не обводит. Отсюда же правило
// заливок: поднятая поверхность светлее фона, утопленная — темнее. Без
// обводки различить их можно только так, поэтому `paperTile` стал темнее
// страницы, а не светлее, как был.

/** Крупная поверхность: модуль, панель прогноза, состояние ошибки. */
export const paperCard =
  "rounded-[20px] bg-tm-surface shadow-[0_1px_2px_rgba(70,54,36,0.04),0_10px_30px_-14px_rgba(70,54,36,0.16)]";

/** Та же поверхность с меньшим радиусом: шаг мастера, корешок, шкала уровней. */
export const paperStrip =
  "rounded-[18px] bg-tm-surface shadow-[0_1px_2px_rgba(70,54,36,0.04),0_10px_30px_-14px_rgba(70,54,36,0.16)]";

/**
 * Утопленная плитка: строка темы, ячейка выбора, врезка с пояснением.
 *
 * Темнее и поднятой карточки, и фона страницы — одна заливка обязана работать
 * в обоих контекстах, потому что плитки встречаются и внутри `paperCard`, и
 * прямо на полотне раздела.
 */
export const paperInset = "rounded-[14px] bg-tm-surface-2";

/** @deprecated Имя из времён обводок. Осталось синонимом, чтобы не переписывать 19 файлов разом. */
export const paperTile = paperInset;

/** Разделитель внутри поверхности. Единственная линия, которая уцелела. */
export const paperRule = "border-t border-tm-line";

export const paperFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tm-accent/35";

/** Второстепенное действие. */
export const paperButton =
  `inline-flex items-center justify-center gap-2 rounded-full border border-tm-line bg-tm-surface px-4 py-2 text-[13px] text-tm-ink-2 transition-colors hover:border-tm-accent hover:bg-tm-bg hover:text-tm-ink disabled:cursor-not-allowed disabled:opacity-55 ${paperFocus}`;

/**
 * Тихое действие: навигация, переключение, всё, что нажимают часто.
 *
 * Края нет, пока на кнопку не навели. Ряд из трёх таких кнопок не рисует на
 * странице три рамки — а именно ряд `← Сегодня →` в шапке календаря и был
 * самым шумным местом раздела.
 */
export const paperQuietButton =
  `inline-flex items-center justify-center gap-2 rounded-full px-3.5 py-2 text-[13px] text-tm-muted transition-colors hover:bg-tm-surface-2 hover:text-tm-ink disabled:cursor-not-allowed disabled:opacity-55 ${paperFocus}`;

/** Главное действие страницы. Ровно одно на экран. */
export const paperPrimaryButton =
  `inline-flex items-center justify-center gap-2 rounded-full bg-tm-accent px-5 py-2 text-[13px] font-medium text-tm-on-strong transition-colors hover:bg-tm-accent/90 disabled:cursor-not-allowed disabled:opacity-55 ${paperFocus}`;

/**
 * Переключатель вида: утопленная дорожка и приподнятая на ней накладка.
 *
 * Активный сегмент был залит `#8a5b24` — тем же коричневым, которым в
 * приложении помечено главное действие. Выбор вида календаря главным
 * действием не является, и цвет обещал больше, чем нажатие делало. Теперь
 * активное состояние читается как приподнятая бумажка, а коричневый остался
 * там, где он что-то значит.
 */
export const paperSegment = "inline-flex rounded-full bg-tm-surface-2 p-[3px]";
export const paperSegmentItem =
  `rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${paperFocus}`;
export const paperSegmentActive =
  "bg-tm-surface text-tm-ink shadow-[0_1px_2px_rgba(70,54,36,0.10)]";
export const paperSegmentIdle = "text-tm-muted hover:text-tm-ink-2";

/** Микроподпись: 10px, разрядка, приглушённый тон. */
export const paperCaption =
  "text-[10px] font-medium uppercase tracking-[0.16em] text-tm-faint";

/**
 * Числа набираются, а не выводятся.
 *
 * `font-serif` здесь — это Georgia, домашняя подпись помодоро. Вместе с
 * `tabular-nums` она отличает цифры программы от цифр любого дашборда.
 */
export const paperNumber = "font-serif tabular-nums tracking-[-0.03em]";

/**
 * Тон модуля на корешке: один оттенок (hue 30), меняется только яркость.
 *
 * Первый модуль самый тёмный, последний самый светлый — так полоса читается
 * как книга слева направо, а не как разноцветная легенда.
 */
export function moduleTone(index: number, total: number): string {
  if (total <= 1) return "hsl(30 40% 38%)";
  const step = Math.min(Math.max(index / (total - 1), 0), 1);
  const lightness = 34 + step * 30;
  const saturation = 42 - step * 16;
  return `hsl(30 ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`;
}
