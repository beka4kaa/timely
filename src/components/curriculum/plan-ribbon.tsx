// Корешок книги: горизонтальная полоса = весь учебник, страницы 1..N.
//
// Полоса отвечает на вопрос, который список карточек задать не может: что из
// книги в программу НЕ вошло. Она же заменяет процент покрытия, который на
// разноязычной паре (учебник английский, программа русская) честно давал ноль
// и потому врал.
//
// Отрезки намеренно НЕ являются табстопами и помечены `aria-hidden`. Книга на
// сорок тем вставила бы шестьдесят с лишним остановок табуляции перед
// содержимым. Доступный путь идёт через строки тем: фокус на строке
// подсвечивает её отрезки, и это то же самое знание.

"use client";

import type { RibbonModel } from "@/lib/curriculum-ribbon";
import { coverageCaption } from "@/lib/curriculum-ribbon";
import { moduleTone, paperCaption, paperNumber, paperStrip } from "./paper";

const LANE_HEIGHT = 14;
const LANE_GAP = 4;
const TRACK_PADDING = 6;

interface PlanRibbonProps {
  model: RibbonModel;
  moduleTitles: string[];
  hoveredTopicId: string | null;
  onHoverTopic: (topicId: string | null) => void;
}

export function PlanRibbon({
  model,
  moduleTitles,
  hoveredTopicId,
  onHoverTopic,
}: PlanRibbonProps) {
  if (model.unitCount === 0) return null;

  const lanes = Math.max(model.laneCount, 1);
  const trackHeight =
    lanes * LANE_HEIGHT + (lanes - 1) * LANE_GAP + TRACK_PADDING * 2;
  const unitNoun = model.scale === "pages" ? "страниц" : "разделов";

  return (
    <section className={`${paperStrip} p-5 sm:p-6`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className={paperCaption}>
          {model.scale === "pages" ? "Корешок книги" : "Оглавление книги"}
        </p>
        <p className="text-[11px] text-[#9b9186]">
          {model.scale === "pages" ? "Слева направо — от первой страницы к последней" : "Слева направо — по оглавлению"}
        </p>
      </div>

      <div
        className="relative overflow-hidden rounded-[10px] border border-[#e0d9cd] bg-[#f5f0e7]"
        style={{ height: trackHeight }}
        role="img"
        aria-label={`${coverageCaption(model)}. Тёмным отмечены участки книги, вошедшие в программу.`}
      >
        {/* Непокрытые участки — бледная штриховка во всю высоту: это ровно те
            страницы, которых нет ни в одной теме. */}
        {model.gaps.map((gap) => (
          <div
            key={`gap-${gap.startPct}`}
            aria-hidden
            className="absolute inset-y-0"
            style={{
              left: `${gap.startPct}%`,
              width: `${gap.widthPct}%`,
              backgroundImage:
                "repeating-linear-gradient(-45deg, rgba(140,120,94,0.16) 0 1px, transparent 1px 5px)",
            }}
          />
        ))}

        {model.segments.map((segment) => (
          <div
            key={segment.key}
            aria-hidden
            className="absolute rounded-[3px] transition-[opacity,filter] duration-150"
            style={{
              left: `${segment.startPct}%`,
              width: `${segment.widthPct}%`,
              minWidth: 2,
              top: TRACK_PADDING + segment.lane * (LANE_HEIGHT + LANE_GAP),
              height: LANE_HEIGHT,
              background: moduleTone(segment.moduleIndex, moduleTitles.length),
              opacity:
                hoveredTopicId && hoveredTopicId !== segment.topicId ? 0.22 : 1,
              boxShadow:
                hoveredTopicId === segment.topicId
                  ? "0 0 0 1.5px #fffdfa, 0 0 0 3px rgba(138,91,36,0.55)"
                  : "none",
            }}
          />
        ))}

        {/* Обрез книжного блока: торцы страниц поверх заливки. Материал
            предмета — бумага, и без него полоса читается как метрика из
            дашборда, а не как книга. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.45] mix-blend-multiply"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,253,250,0.55) 0 1px, rgba(96,74,48,0.10) 1px 2px, transparent 2px 5px)",
          }}
        />

        {/* Зоны наведения отдельно от заливки: одна страница шестисотстраничной
            книги — это 0.17% ширины, в неё не попасть курсором. Геометрия
            остаётся честной, расширяется только цель. */}
        {model.segments.map((segment) => (
          <div
            key={`hit-${segment.key}`}
            aria-hidden
            className="absolute inset-y-0"
            style={{
              left: `${segment.startPct}%`,
              width: `${segment.widthPct}%`,
              minWidth: `${model.minWidthPct}%`,
            }}
            onMouseEnter={() => onHoverTopic(segment.topicId)}
            onMouseLeave={() => onHoverTopic(null)}
          />
        ))}
      </div>

      {model.brackets.length > 0 && (
        <div className="relative mt-1.5 h-5" aria-hidden>
          {model.brackets.map((bracket) => (
            <div
              key={`bracket-${bracket.moduleIndex}`}
              className="absolute top-0 flex flex-col items-center"
              style={{
                left: `${bracket.startPct}%`,
                width: `${bracket.widthPct}%`,
                minWidth: `${model.minWidthPct}%`,
              }}
            >
              <span className="h-1.5 w-full border-x border-b border-[#cfc6b8]" />
              <span
                className={`${paperNumber} mt-0.5 text-[10px] leading-none text-[#a1978b]`}
              >
                {bracket.moduleIndex + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[#e7e1d7] pt-3">
        <p className="text-[13px] text-[#4a443d]">
          {model.scale === "pages" ? "Страниц" : "Разделов"} в программе:{" "}
          <span className={`${paperNumber} text-[15px] text-[#302b26]`}>
            {model.claimedUnits}
          </span>{" "}
          из{" "}
          <span className={`${paperNumber} text-[15px] text-[#302b26]`}>
            {model.totalUnits}
          </span>
        </p>
        {model.axisExtended && (
          <p className="text-[11px] text-[#9b9186]">
            Ссылки уходят дальше, чем заявлено {unitNoun} в книге — полоса
            растянута по ссылкам.
          </p>
        )}
      </div>
    </section>
  );
}
