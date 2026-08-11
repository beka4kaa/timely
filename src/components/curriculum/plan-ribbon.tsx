// Корешок книги: горизонтальная полоса = весь учебник, страницы 1..N.
//
// Полоса отвечает на вопрос, который список карточек задать не может: что из
// книги в программу НЕ вошло. Она же заменяет процент покрытия, который на
// разноязычной паре (учебник английский, программа русская) честно давал ноль
// и потому врал.
//
// ФИГУРА ЗДЕСЬ — ДЫРЫ, А НЕ ПОКРЫТИЕ. Сначала было наоборот: тёмным закрашивали
// вошедшее, дыры оставались бледной штриховкой под плотной сеткой засечек. На
// шестистах страницах это читалось как «книга закрыта целиком» — то есть ответ
// на вопрос, которого никто не задавал, а настоящий терялся в фоне.
//
// Заодно ушла раскраска по модулям. Одиннадцать глав кодировались одним тоном
// по светлоте (`hsl(30 …%)` с шагом в три процента) — последовательной шкалой
// на категориях. Сопоставить чип легенды с засечкой было невозможно, и легенда
// на три строки исчезла вместе с раскраской: номера глав идут скобками под
// полосой и говорят то же самое.
//
// Отрезки тем намеренно НЕ являются табстопами и помечены `aria-hidden`. Книга
// на сорок тем вставила бы шестьдесят с лишним остановок табуляции перед
// содержимым. Доступный путь идёт через строки тем: фокус на строке
// подсвечивает её место в книге, и это то же самое знание.

"use client";

import type { RibbonModel } from "@/lib/curriculum-ribbon";
import { coverageCaption, gapsCaption } from "@/lib/curriculum-ribbon";
import { paperCaption, paperNumber, paperStrip } from "./paper";

const LANE_HEIGHT = 14;
const LANE_GAP = 4;
const TRACK_PADDING = 6;

interface PlanRibbonProps {
  model: RibbonModel;
  hoveredTopicId: string | null;
  onHoverTopic: (topicId: string | null) => void;
}

export function PlanRibbon({
  model,
  hoveredTopicId,
  onHoverTopic,
}: PlanRibbonProps) {
  if (model.unitCount === 0) return null;

  const lanes = Math.max(model.laneCount, 1);
  const trackHeight =
    lanes * LANE_HEIGHT + (lanes - 1) * LANE_GAP + TRACK_PADDING * 2;
  const unitNoun = model.scale === "pages" ? "страниц" : "разделов";
  const missing = gapsCaption(model);

  return (
    <section className={`${paperStrip} p-5 sm:p-6`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className={paperCaption}>
          {model.scale === "pages" ? "Корешок книги" : "Оглавление книги"}
        </p>
        <p className="text-[11px] text-[#9b9186]">
          {missing
            ? "Тёмным — то, что мимо программы"
            : "Программа покрывает книгу целиком"}
        </p>
      </div>

      <div
        className="relative overflow-hidden rounded-[10px] border border-[#e0d9cd] bg-[#f5f0e7]"
        style={{ height: trackHeight }}
        role="img"
        aria-label={`${coverageCaption(model)}. ${
          missing || "Пропусков нет."
        }`}
      >
        {/* Пропуски — единственное, что залито в покое. */}
        {model.gaps.map((gap) => (
          <div
            key={`gap-${gap.startUnit}`}
            aria-hidden
            className="absolute inset-y-0 bg-[#8d7c62]"
            style={{
              left: `${gap.startPct}%`,
              width: `${gap.widthPct}%`,
              // Одна страница шестисотстраничной книги — это 0.17 % ширины.
              // Пропуск в одну страницу обязан быть виден.
              minWidth: 2,
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

        {/* Место темы в книге. В покое его нет вовсе: показывать разом все
            отрезки значило бы вернуть ту же сетку засечек. Появляется под
            курсором — своим, или наведённым на строку темы в списке. */}
        {model.segments
          .filter((segment) => segment.topicId === hoveredTopicId)
          .map((segment) => (
            <div
              key={segment.key}
              aria-hidden
              className="pointer-events-none absolute rounded-[3px] bg-[#b7792d] shadow-[0_0_0_1.5px_#fffdfa]"
              style={{
                left: `${segment.startPct}%`,
                width: `${segment.widthPct}%`,
                minWidth: 2,
                top: TRACK_PADDING + segment.lane * (LANE_HEIGHT + LANE_GAP),
                height: LANE_HEIGHT,
              }}
            />
          ))}

        {/* Зоны наведения отдельно от заливки: в 0.17 % ширины не попасть
            курсором. Геометрия остаётся честной, расширяется только цель. */}
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

      <div className="mt-4 space-y-1 border-t border-[#e7e1d7] pt-3">
        {/* Пропуски идут первой строкой: полоса показывает, ГДЕ дыры, строка —
            какие именно. Счёт страниц — уже итог, и он вторым. */}
        {missing && (
          <p className="text-[13px] leading-5 text-[#4a443d]">{missing}</p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-[13px] text-[#7f776e]">
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
      </div>
    </section>
  );
}
