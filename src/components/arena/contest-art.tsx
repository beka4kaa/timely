// Картинки на плашках контестов. Цвет идёт от самой плашки, поэтому здесь только контуры.

import type { ContestArtKind } from "@/lib/contest-view";

/** Кольца на билете: по одному на задачу, но не больше четырёх, дальше они заходят на текст. */
const HERO_RINGS: Array<[radius: number, dash: number, opacity: number]> = [
  [124, 68, 0.5],
  [97, 46, 0.68],
  [70, 81, 0.84],
  [43, 30, 1],
];

export function HeroArt({ tasks }: { tasks: number }) {
  const rings = HERO_RINGS.slice(-Math.max(1, Math.min(tasks, HERO_RINGS.length)));
  return (
    <svg className="plq-art" viewBox="0 0 400 178" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <g className="spin" fill="none" stroke="currentColor" strokeWidth="15" strokeLinecap="round">
        <g transform="rotate(-90 232 89)">
          {rings.map(([radius, dash, opacity]) => (
            <g key={radius}>
              <circle cx="232" cy="89" r={radius} opacity=".1" />
              <circle cx="232" cy="89" r={radius} pathLength={100} strokeDasharray={`${dash} 100`} opacity={opacity} />
            </g>
          ))}
        </g>
      </g>
      <use href="#art-slime" x="213" y="76" width="38" height="27" />
    </svg>
  );
}

export function CardArt({ kind }: { kind: ContestArtKind }) {
  if (kind === "throw") {
    // Один бросок под разными углами: дальше всего под 45°.
    return (
      <svg className="plq-art" viewBox="0 0 360 176" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeLinecap="round">
          <path d="M0 168H360" opacity=".4" />
          <path d="M30 168Q110 146.6 190 168" opacity=".3" />
          <path d="M30 168Q168.5 88 307 168" opacity=".45" />
          <path d="M30 168Q190 8 350 168" strokeWidth="2.2" />
          <path d="M30 168Q168.5 -72 307 168" opacity=".45" />
          <path d="M30 168Q110 -130.6 190 168" opacity=".3" />
          <path d="M30 168L66 132M57 134.5 66 132 63.5 141" strokeWidth="2" strokeLinejoin="round" />
        </g>
        <use className="fly" href="#art-slime" x="166" y="61" width="48" height="34" />
      </svg>
    );
  }
  if (kind === "dots") {
    // Орбиты из точек.
    return (
      <svg className="plq-art" viewBox="0 0 300 176" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">
        <g className="spin" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
          <circle cx="212" cy="88" r="92" pathLength={120} strokeDasharray="0 8" opacity=".4" />
          <circle cx="212" cy="88" r="66" pathLength={96} strokeDasharray="0 8" opacity=".6" />
          <circle cx="212" cy="88" r="40" pathLength={64} strokeDasharray="0 8" opacity=".85" />
        </g>
        <use href="#art-slime" x="193" y="75" width="38" height="27" />
      </svg>
    );
  }
  return (
    <svg className="plq-art" viewBox="0 0 300 176" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">
      <g className="spin" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" transform="rotate(-90 212 88)">
        <circle cx="212" cy="88" r="92" pathLength={100} strokeDasharray="62 100" opacity=".45" />
        <circle cx="212" cy="88" r="66" pathLength={100} strokeDasharray="44 100" opacity=".68" />
        <circle cx="212" cy="88" r="40" pathLength={100} strokeDasharray="78 100" opacity=".9" />
      </g>
      <use href="#art-slime" x="193" y="75" width="38" height="27" />
    </svg>
  );
}

export function MiniArt({ kind, seed }: { kind: ContestArtKind; seed: number }) {
  if (kind === "throw") {
    return (
      <svg className="plq-art" viewBox="0 0 92 92" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2">
          <path d="M6 80Q46 -4 86 80" opacity=".9" />
          <path d="M6 80Q26 -30 46 80" opacity=".45" />
          <path d="M6 80Q40 40 74 80" opacity=".6" />
          <path d="M0 80H92" opacity=".4" />
        </g>
      </svg>
    );
  }
  if (kind === "dots") {
    return (
      <svg className="plq-art" viewBox="0 0 92 92" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 46 46)">
          <circle cx="46" cy="46" r="38" pathLength={96} strokeDasharray="0 8" opacity=".55" />
          <circle cx="46" cy="46" r="24" pathLength={64} strokeDasharray="0 8" opacity=".85" />
        </g>
      </svg>
    );
  }
  // Длина дуг от номера контеста: плашки в ряду различаются, а при каждом заходе одинаковы.
  const dash = (shift: number) => 30 + ((seed * 13 + shift * 29) % 56);
  return (
    <svg className="plq-art" viewBox="0 0 92 92" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" transform="rotate(-90 46 46)">
        <circle cx="46" cy="46" r="38" pathLength={100} strokeDasharray={`${dash(1)} 100`} opacity=".5" />
        <circle cx="46" cy="46" r="26" pathLength={100} strokeDasharray={`${dash(2)} 100`} opacity=".7" />
        <circle cx="46" cy="46" r="14" pathLength={100} strokeDasharray={`${dash(3)} 100`} opacity=".9" />
      </g>
    </svg>
  );
}
