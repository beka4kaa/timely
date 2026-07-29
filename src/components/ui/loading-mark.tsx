/**
 * Индикатор загрузки Timely — три искры, которые разгораются по очереди.
 *
 * Заменяет крутящуюся дугу из `border-b-2`: она читается как «страница
 * подвисла», ничего не говорит о продукте и одинаково выглядит в любом
 * приложении. Искры разгораются со сдвигом по фазе, поэтому движение остаётся
 * живым, но не дёргает глаз.
 *
 * Цвет берётся из `currentColor` — компонент не навязывает палитру и одинаково
 * уместен на тёплом холсте доски и на нейтральном экране входа.
 */

/** Четырёхлучевая искра с вогнутыми сторонами, центр в начале координат,
 * внешний радиус 1. Масштаб задаётся трансформом группы, поэтому одна и та же
 * геометрия годится и для крупной искры, и для мелких спутников. */
const SPARK =
  'M0,-1 C0.12,-0.35 0.35,-0.12 1,0 C0.35,0.12 0.12,0.35 0,1 ' +
  'C-0.12,0.35 -0.35,0.12 -1,0 C-0.35,-0.12 -0.12,-0.35 0,-1 Z';

interface LoadingMarkProps {
  /** Сторона квадрата в пикселях. */
  size?: number;
  /** Подпись рядом с искрами. Без неё индикатор остаётся чисто визуальным. */
  label?: string;
  className?: string;
}

export function LoadingMark({ size = 40, label, className }: LoadingMarkProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center gap-2.5 ${className ?? ''}`}
    >
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        className="loading-mark"
      >
        {/* Порядок групп задаёт и порядок вспышек: крупная искра первая.
            Разница масштабов намеренно большая — при близких размерах три искры
            читаются как три одинаковые точки, и композиция рассыпается. */}
        <g transform="translate(22 25) scale(15)">
          <path className="loading-mark-spark" d={SPARK} />
        </g>
        <g transform="translate(38 11) scale(4.6)">
          <path className="loading-mark-spark" d={SPARK} />
        </g>
        <g transform="translate(12 38) scale(3.4)">
          <path className="loading-mark-spark" d={SPARK} />
        </g>
      </svg>
      {label ? (
        <span className="text-[11px] leading-relaxed text-current opacity-70">
          {label}
        </span>
      ) : (
        <span className="sr-only">Загрузка</span>
      )}
    </div>
  );
}
