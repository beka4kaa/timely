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

/** Крупная карточка: модуль, панель прогноза, состояние ошибки. */
export const paperCard =
  "rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]";

/** Плитка внутри карточки: строка темы, ячейка выбора. */
export const paperTile = "rounded-[14px] border border-[#e4ded4] bg-[#fffdfa]";

/** Полоса между карточкой и плиткой: корешок, шкала уровней. */
export const paperStrip = "rounded-[18px] border border-[#ded7cd] bg-[#fffdfa]";

export const paperFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35";

/** Второстепенное действие. */
export const paperButton =
  `inline-flex items-center justify-center gap-2 rounded-full border border-[#d8d1c7] bg-[#fffdfa] px-4 py-2 text-[13px] text-[#5f584f] transition-colors hover:border-[#c7aa82] hover:bg-[#fff8ec] hover:text-[#312c27] disabled:cursor-not-allowed disabled:opacity-55 ${paperFocus}`;

/** Главное действие страницы. Ровно одно на экран. */
export const paperPrimaryButton =
  `inline-flex items-center justify-center gap-2 rounded-full border border-[#8a5b24] bg-[#8a5b24] px-5 py-2 text-[13px] font-medium text-[#fdf8ef] transition-colors hover:border-[#754a19] hover:bg-[#754a19] disabled:cursor-not-allowed disabled:opacity-55 ${paperFocus}`;

/** Микроподпись: 10px, разрядка, приглушённый тон. */
export const paperCaption =
  "text-[10px] font-medium uppercase tracking-[0.16em] text-[#9b9186]";

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
