// Бейджи: значки с числом или формулой. Яркий значит заработан по настоящим данным.

import type { Badge, BadgeShape } from "@/lib/profile-view";

/** Звезда или печать с волнистым краем: углы скругляет обводка. */
function star(points: number, outer: number, inner: number): string {
  const nodes: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const radius = index % 2 === 0 ? outer : inner;
    nodes.push(`${(32 + radius * Math.cos(angle)).toFixed(1)} ${(32 + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return `M${nodes.join("L")}Z`;
}

const SHAPES: Record<BadgeShape, string> = {
  hex: "M32 6 54.5 19V45L32 58 9.5 45V19Z",
  seal: star(12, 27, 23.5),
  circle: "M32 6a26 26 0 1 0 0 52a26 26 0 1 0 0-52Z",
  shield: "M32 6 53 12.5V31C53 44 44 53 32 58 20 53 11 44 11 31V12.5Z",
  squircle: "M32 7C50 7 57 14 57 32S50 57 32 57 7 50 7 32 14 7 32 7Z",
  star: star(8, 28, 21),
  diamond: "M32 5 59 32 32 59 5 32Z",
  penta: "M32 6 57 24 47.5 56H16.5L7 24Z",
};

function BadgeArt({ badge }: { badge: Badge }) {
  const shape = SHAPES[badge.shape];
  const paint = `bdg-paint-${badge.key}`;
  const clip = `bdg-clip-${badge.key}`;
  return (
    <svg className="bdg" viewBox="-3 -3 70 70" aria-hidden="true">
      <defs>
        <linearGradient id={paint} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={badge.from} />
          <stop offset="1" stopColor={badge.to} />
        </linearGradient>
        <clipPath id={clip}>
          <path d={shape} />
        </clipPath>
      </defs>
      <path d={shape} fill={`url(#${paint})`} stroke={`url(#${paint})`} strokeWidth="5" strokeLinejoin="round" />
      <g clipPath={`url(#${clip})`}>
        <ellipse cx="24" cy="9" rx="34" ry="19" fill="#ffffff" opacity="0.22" />
      </g>
      <path
        d={shape}
        transform="translate(32 32) scale(0.82) translate(-32 -32)"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.5"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <text
        className={badge.kind ? `bdg-t ${badge.kind}` : "bdg-t"}
        x="32"
        y={(32 + badge.size * 0.35).toFixed(1)}
        fontSize={badge.size}
        textAnchor="middle"
      >
        {badge.glyph}
      </text>
    </svg>
  );
}

export function BadgeList({ badges }: { badges: readonly Badge[] }) {
  return (
    <ul className="badges">
      {badges.map((badge) => (
        <li
          key={badge.key}
          className={badge.earned ? "badge" : "badge pf-locked"}
          title={badge.how}
          aria-label={badge.earned ? `${badge.name}: ${badge.how}` : `Ещё нет. ${badge.name}: ${badge.how}`}
        >
          <BadgeArt badge={badge} />
          <span>{badge.name}</span>
        </li>
      ))}
    </ul>
  );
}
