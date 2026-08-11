"use client";

// Закладка: край страницы, торчащий из-за края экрана.
//
// Так открывается свёрнутая панель. Раньше на этом месте висела плашка 36×36 с
// иконкой «panel-right-open» у самой шапки: она спорила с кнопками шапки,
// занимала угол и ничего не говорила о том, что справа спрятано.
//
// Закладка стоит там же, где у открытой панели стоит засечка сгиба, — по
// центру края и той же высоты (56 px). Одна точка, два состояния: закрыто —
// закладка, открыто — засечка, за которую тянут.
//
// Уезжает закладка ровно тем же движением и за то же время, что выезжает
// панель: 300 ms, `ease-in-out`. Это должно читаться как один жест, а не как
// две независимые анимации.
//
// Прижимается к краю ближайшего позиционированного предка: у панели вопросов
// это оболочка дашборда (`relative h-screen`), у колонок страницы «Тьютор» —
// сама колонка разговора.

import { ChevronLeft, ChevronRight } from "lucide-react";

export function EdgeTab({
  side,
  hidden,
  label,
  onClick,
  offsetY = 0,
  className = "",
}: {
  /** К какому краю прижата. Стрелка всегда показывает, куда поедет панель. */
  side: "left" | "right";
  /** Панель открыта — закладке пора уехать за край. */
  hidden: boolean;
  label: string;
  onClick: () => void;
  /**
   * Сдвиг от середины предка вниз, px.
   *
   * Панель вопросов начинается под шапкой, а её предок — вся оболочка вместе
   * с шапкой: без сдвига в половину шапки закладка встала бы на 24 px выше
   * засечки сгиба, и переход из одной в другую перестал бы читаться как одно
   * место. Инлайном, а не классом: два `top-` в одной строке спорили бы
   * порядком в стилях.
   */
  offsetY?: number;
  /**
   * Слой (и любые правки положения) задаёт хозяин.
   *
   * Своего `z-` у закладки нет намеренно: на дашборде ей нужно быть выше
   * `<main>` (`z-[95]`), а внутри колонки страницы — вровень с колонками.
   * Два класса `z-` в одной строке спорили бы порядком в стилях, а не
   * порядком в строке.
   */
  className?: string;
}) {
  const right = side === "right";
  const Arrow = right ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={offsetY ? { top: `calc(50% + ${offsetY}px)` } : undefined}
      className={`group absolute top-1/2 grid h-14 w-5 -translate-y-1/2 place-items-center border border-[#dedbd4] bg-[#fbfaf7]/95 text-[#8a827a] shadow-[0_8px_24px_rgba(67,57,45,0.10)] outline-none backdrop-blur-md transition-[width,transform,border-color,color,opacity] duration-300 ease-in-out hover:w-[22px] hover:border-[#c5a474] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30 motion-reduce:transition-none ${
        right
          ? "right-0 rounded-l-[10px] border-r-0"
          : "left-0 rounded-r-[10px] border-l-0"
      } ${
        // Уезжает за свой край, а не гаснет на месте: панель приходит оттуда же.
        hidden
          ? right
            ? "pointer-events-none translate-x-full opacity-0"
            : "pointer-events-none -translate-x-full opacity-0"
          : "translate-x-0 opacity-100"
      } ${className}`}
      // Уехавшая закладка остаётся в DOM — иначе не из чего анимировать. Без
      // `inert` она ловила бы фокус по Tab у самого края экрана, где её не
      // видно. Атрибут именно ОТСУТСТВУЕТ в обычном состоянии: `inert` булев,
      // и `inert="false"` браузер считает включённым.
      inert={hidden ? true : undefined}
    >
      <Arrow
        className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${
          right
            ? "group-hover:-translate-x-[1px]"
            : "group-hover:translate-x-[1px]"
        }`}
      />
    </button>
  );
}
