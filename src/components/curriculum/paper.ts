// Общие классы раздела для компонентов, которые ещё собираются из строк утилит.
//
// Раньше здесь жил «бумажный» диалект с тёплыми хексами. Теперь это те же кирпичи,
// что у остальных страниц: `.card`, `.btn`, `.tabs` и токены `--t-*`. Имена оставлены:
// файл импортируют соседние разделы, и им незачем знать о переезде.

/** Крупная поверхность: модуль, панель прогноза, состояние ошибки. */
export const paperCard = "card [--r:18px]";

/** Та же поверхность с меньшим радиусом: шаг мастера, шкала уровней. */
export const paperStrip = "card [--r:16px]";

/** Утопленная плитка: строка темы, ячейка выбора, врезка с пояснением. */
export const paperInset = "rounded-[14px] bg-[var(--t-hover)]";

/** @deprecated Имя из времён обводок. Осталось синонимом для соседних разделов. */
export const paperTile = paperInset;

/** Разделитель внутри поверхности. */
export const paperRule = "border-t border-[var(--t-line)]";

export const paperFocus =
  "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--t-ink)_62%,transparent)]";

const PAPER_DISABLED = "disabled:cursor-not-allowed disabled:opacity-55";

/** Второстепенное действие. */
export const paperButton = `btn btn-line ${PAPER_DISABLED}`;

/** Тихое действие: навигация, переключение, всё, что нажимают часто. */
export const paperQuietButton = `btn btn-text ${PAPER_DISABLED}`;

/** Главное действие страницы. Ровно одно на экран. */
export const paperPrimaryButton = `btn btn-main ${PAPER_DISABLED}`;

/** Всплывающий лист: меню и короткие формы. Он в портале, поэтому шрифт задан явно. */
export const paperPopover =
  "w-auto rounded-[14px] border-0 bg-[var(--t-cloud)] p-[5px] font-[family-name:var(--t-sans)] text-[13px] text-[color:var(--t-ink)] shadow-[var(--t-glass-shadow)]";

/** Переключатель вида: капсула и приподнятая на ней накладка, как `.tabs`. */
export const paperSegment = "inline-flex gap-px rounded-[11px] bg-[var(--t-hover)] p-0.5";
export const paperSegmentItem =
  `h-7 rounded-[9px] px-[11px] text-[13px] transition-colors ${paperFocus}`;
export const paperSegmentActive =
  "bg-[var(--t-pill)] font-medium text-[color:var(--t-ink)] shadow-[var(--t-pill-sh)]";
export const paperSegmentIdle = "text-[color:var(--t-muted)] hover:text-[color:var(--t-ink)]";

/** Подпись поля или блока. */
export const paperCaption = "text-[12.5px] text-[color:var(--t-muted)]";

/** Числа в колонке не должны прыгать. */
export const paperNumber = "tabular-nums";
