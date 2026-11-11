// Маскот: белый слайм в правом нижнем углу.
//
// Контур считается заново в каждом кадре: желе на пружинах (сжатие с сохранением
// объёма, наклон, волна по поверхности), а лицо, блик и внутреннее ядро отстают от
// тела каждый по-своему. Глаза — тонкие линии с утолщением к середине, они плавно
// перетекают из одного выражения в другое.
//
// React здесь только монтирует разметку: в каждом кадре атрибуты меняются напрямую,
// иначе шестьдесят перерисовок в секунду шли бы через всё дерево каскада.
//
// Тот же слайм живёт и вне приложения — на лендинге и страницах входа («сцена», см.
// MascotStageOptions). Там нет реплик и плашки над головой, а кадры считаются, только
// пока он виден на экране.

import { BOOKS_ENABLED } from "@/config/features";
import type { DashboardView } from "@/config/dashboard-navigation";

export type MascotExpression =
  | "calm"
  | "happy"
  | "sharp"
  | "sad"
  | "sleep"
  | "squeeze"
  | "wow"
  | "blink"
  | "think";

export interface MascotEngine {
  hop: (power?: number, kind?: "quiet") => void;
  wiggle: () => void;
  say: (text?: string) => void;
  /** Начал думать над запросом: плашка над головой, глаза вверх. */
  thinkStart: (title: string, onStop?: () => void) => void;
  /** Текущий шаг работы. Переливается белым, пока идёт. */
  thought: (text: string) => void;
  /** Без текста: остановили, плашка уходит. С текстом: готово, она ещё немного висит. */
  thinkEnd: (ready?: string) => void;
  /**
   * Напоминание: та же плашка, но с кнопкой «открыть». `long` показывает несколько строк, а
   * не одну, `stay` держит её, пока ученик сам не откроет или не закроет.
   */
  remind: (title: string, text: string, go: () => void, options?: { long?: boolean; stay?: boolean }) => void;
  remindOff: () => void;
  hideCard: () => void;
  mood: (name: MascotExpression) => void;
  react: (name: MascotExpression, seconds?: number) => void;
  focus: (on: boolean) => void;
  setView: (view: DashboardView) => void;
  destroy: () => void;
}

/**
 * Слайм на странице, а не в углу приложения: стоит в вёрстке, кадры идут, только пока
 * он на экране, на прокрутку страницы откликается желе. Перетащить можно только мышью:
 * пальцем по нему листают страницу. Без кнопки `.mascot-hit` в разметке он не
 * реагирует на курсор и нажатия, а просто живёт.
 */
export interface MascotStageOptions {
  /** Падает сверху при первом показе. */
  drop?: boolean;
  /** Чем он сопит во сне: «з» по-русски, «z» по-английски. */
  sleepGlyph?: string;
}

/** С какой высоты падает слайм при первом показе, в единицах рисунка, и сколько секунд ждёт. */
const DROP_HEIGHT = 330;
const DROP_HOLD = 0.42;
/** Быстрее этого сцена не падает: приземление с прыжка в приложении — около 380. */
const TERMINAL_SPEED = 560;

interface Spring {
  x: number;
  v: number;
  to: number;
  k: number;
  c: number;
}

interface Particle {
  kind: "drop" | "heart" | "z";
  node: SVGElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
}

type Action =
  | { type: "hop"; t: number; power: number; wait: number }
  | { type: "wiggle"; t: number; step: number }
  | { type: "stretch"; t: number };

const CX = 120;
const GROUND = 196;
const A = 80;
const H = 110;
const BELLY = 36;
const FACE = 47;
const N = 32;
const CORE_N = 16;
const TAU = Math.PI * 2;
const SVGNS = "http://www.w3.org/2000/svg";

/**
 * Выражения. Точки правого глаза, x наружу от центра лица, y вниз: внутренний
 * конец, контрольная точка, внешний конец, толщина, ресницы, румянец, кривизна рта
 * и его заметность, ротик «о».
 */
const EX: Record<MascotExpression, number[]> = {
  calm: [11, 3, 28, -9, 47, 3, 3, 0.8, 0.9, 0, 0, 0],
  happy: [14, 4, 29, -18, 44, 4, 3.4, 0.45, 1, 5.5, 1, 0],
  sharp: [9, 7, 28, 1, 50, -7, 3.1, 0.55, 0.5, 0, 0, 0],
  sad: [13, -4, 29, -8, 46, 8, 2.9, 0.85, 1, -4.6, 1, 0],
  sleep: [12, 1, 29, 11, 47, 1, 2.9, 0.95, 0.75, 0, 0, 0],
  squeeze: [44, -9, -6, 1, 44, 9, 4, 0, 1, -3, 0.8, 0],
  wow: [17, -3, 30, -8, 43, -3, 2.5, 0.4, 0.8, 0, 0, 1],
  blink: [11, 3, 29, 1.5, 47, 3, 2.4, 0.25, 0.9, 0, 0, 0],
  think: [12, -1, 29, -10, 46, -3, 2.8, 0.55, 0.85, -1.3, 0.85, 0],
};

/** Реплики по нажатию: сам он не лезет. Без чисел, которых здесь не знает. */
const LINES: Partial<Record<DashboardView, string>> = {
  now: "Застрял на текущем деле? Спроси, разберёмся.",
  diary: "Нажми «В план», и я поставлю задание в свободное окно.",
  plan: "Скажи, что поменялось, и я перестрою неделю. Можно указать урок курсором.",
  weak: "Напиши, что сегодня изучил, а темы я заполню сам.",
  goals: "Напиши цель своими словами, срок и привычки подберу сам.",
  habits: "Сделал сегодня, нажми на карточку. Один день, один квадратик.",
  chat: "Спрашивай о чём угодно, не только по книге.",
  board: "Выдели что угодно на доске и спроси.",
  library: BOOKS_ENABLED
    ? "Загрузи учебник, и я буду отвечать по его страницам."
    : "Добавь предмет, и я помогу поставить по нему занятия.",
  course: "Спроси по этой главе, отвечу со ссылкой на страницу.",
  contests: "На контесте я молчу, такие правила. Зато потом разберём всё.",
  rating: "Рейтинг растёт от задач без подсказок.",
  focus: "Я рядом и не отвечаю, пока идёт сессия.",
  profile: "Нажми на дни или баллы, покажу подробнее.",
  prefs: "Всё, что я помню, можно удалить здесь же.",
};
const DEFAULT_LINE = "Нужна помощь? Спроси.";

const sgn = (x: number) => (x < 0 ? -1 : 1);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const pow = (x: number, p: number) => Math.pow(Math.abs(x), p);
const n1 = (x: number) => Math.round(x * 10) / 10;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const spring = (k: number, c: number): Spring => ({ x: 0, v: 0, to: 0, k, c });

/** Замкнутый сплайн Катмулла — Рома в кубические кривые. */
function closedPath(p: Float64Array, count: number): string {
  let d = `M${n1(p[0])} ${n1(p[1])}`;
  for (let i = 0; i < count; i++) {
    const i0 = (i - 1 + count) % count;
    const i2 = (i + 1) % count;
    const i3 = (i + 2) % count;
    const x1 = p[i * 2];
    const y1 = p[i * 2 + 1];
    const x2 = p[i2 * 2];
    const y2 = p[i2 * 2 + 1];
    d +=
      `C${n1(x1 + (x2 - p[i0 * 2]) / 6)} ${n1(y1 + (y2 - p[i0 * 2 + 1]) / 6)} ` +
      `${n1(x2 - (p[i3 * 2] - x1) / 6)} ${n1(y2 - (p[i3 * 2 + 1] - y1) / 6)} ${n1(x2)} ${n1(y2)}`;
  }
  return `${d}Z`;
}

function eyePath(mx: number, e: number[]): string {
  const x0 = e[0] * mx;
  const y0 = e[1];
  const cx = e[2] * mx;
  const cy = e[3];
  const x2 = e[4] * mx;
  const y2 = e[5];
  const th = e[6];
  const mxm = (x0 + x2) / 2;
  const mym = (y0 + y2) / 2;
  let px = -(y2 - y0);
  let py = x2 - x0;
  const len = Math.sqrt(px * px + py * py) || 1;
  px /= len;
  py /= len;
  // Вторая кривая смещена к хорде: получается штрих, тонкий на концах.
  const side = (mxm - cx) * px + (mym - cy) * py >= 0 ? 1 : -1;
  const c2x = cx + px * side * th * 2;
  const c2y = cy + py * side * th * 2;
  return `M${n1(x0)} ${n1(y0)}Q${n1(cx)} ${n1(cy)} ${n1(x2)} ${n1(y2)}Q${n1(c2x)} ${n1(c2y)} ${n1(x0)} ${n1(y0)}Z`;
}

export function createMascot(host: HTMLElement, stageOptions?: MascotStageOptions): MascotEngine {
  const stage = stageOptions ?? null;
  const art = host.querySelector<SVGSVGElement>(".mascot-art")!;
  // В приложении кнопка есть всегда; на сцене её нет у слайма-украшения.
  const hit = host.querySelector<HTMLElement>(".mascot-hit");
  // Сколько единиц рисунка в ширине рамки: у приложения 240, у сцены рамка по телу.
  const viewWidth = art.viewBox.baseVal?.width || 240;
  const part = (name: string) => art.querySelector<SVGElement>(`[data-m="${name}"]`)!;
  const el = {
    all: part("all"),
    body: part("body"),
    clip: part("clip"),
    lit: part("lit"),
    core: part("core"),
    rim: part("rim"),
    gloss: part("gloss"),
    face: part("face"),
    blush: part("blush"),
    eyeL: part("eyeL"),
    eyeR: part("eyeR"),
    lash: part("lash"),
    mouth: part("mouth"),
    o: part("o"),
    floor: part("floor"),
    aura: part("aura"),
    fx: part("fx"),
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const S = spring(190, 9.5); // сжатие и растяжение
  const L = spring(105, 7.6); // наклон макушки
  const Fx = spring(70, 12); // лицо отстаёт от тела
  const Fy = spring(70, 12);
  const Gx = spring(46, 7); // блик
  const Gy = spring(46, 7);
  const Cx = spring(24, 3.4); // ядро ходит медленнее всех
  const Cy = spring(24, 3.4);
  const Rt = spring(60, 9); // поворот лица
  const Hx = spring(34, 8.4); // тянут за собой при перетаскивании
  const Hy = spring(320, 26);
  const springs = [S, L, Fx, Fy, Gx, Gy, Cx, Cy, Rt];

  const pos = { x: 0, y: 0, vy: 0 }; // позиция над землёй
  const wave = { a: 0, ph: 0 }; // волна по поверхности
  let round = 0; // дно круглеет в воздухе
  let T = 0; // часы маскота
  let thinking = false; // думает, и насколько это уже заметно
  let thinkK = 0;
  let thinkSide = -1;
  let thinkTurn = 0;
  let coreT = 0; // ядро перемешивается
  let eyeSkew = 0; // один глаз выше другого

  let eye = EX.calm.slice();
  let exprBase: MascotExpression = "calm"; // настроение
  let exprNow: MascotExpression | null = null; // короткая реакция поверх настроения
  let exprUntil = 0;
  let blinkUntil = 0;
  let view: DashboardView = "now";

  function setExpr(name: MascotExpression, seconds?: number) {
    if (seconds) {
      exprNow = name;
      exprUntil = T + seconds;
    } else {
      exprBase = name;
    }
  }

  /* Контур: купол и подушка снизу. В воздухе подушка становится круглой. */
  const angles: number[] = [];
  for (let i = 0; i < N; i++) angles.push((i / N) * TAU);
  const pts = new Float64Array(N * 2);

  function bodyPoints(sx: number, sy: number) {
    const lean = L.x;
    const wA = wave.a;
    const ph = wave.ph;
    const belly = BELLY + round * 8;
    const ex = 0.74 + round * 0.2;
    const ey = 0.86 + round * 0.1;
    for (let i = 0; i < N; i++) {
      const th = angles[i];
      const c = Math.cos(th);
      const s = Math.sin(th);
      let x: number;
      let u: number;
      if (s >= 0) {
        x = A * sgn(c) * pow(c, 0.9);
        u = belly + (H - belly) * pow(s, 0.94);
        x *= 1 - 0.03 * pow(u / H, 2);
      } else {
        x = A * sgn(c) * pow(c, ex);
        u = belly * (1 - pow(s, ey));
      }
      const dx = x;
      const du = u - H * 0.42;
      const len = Math.sqrt(dx * dx + du * du) || 1;
      let X = x * sx;
      let U = u * sy;
      const t = clamp(U / (H * sy), 0, 1);
      X += lean * pow(t, 1.35);
      const w = wA * (0.62 * Math.sin(3 * th + ph) + 0.38 * Math.sin(5 * th - ph * 1.3)) * pow(t, 0.7);
      X += (dx / len) * w;
      U += (du / len) * w;
      pts[i * 2] = CX + X;
      pts[i * 2 + 1] = GROUND - U;
    }
  }

  const corePts = new Float64Array(CORE_N * 2);
  function corePath(sx: number, sy: number) {
    /* Ядро внутри: плотная лужица с выпуклостью к макушке. */
    const cu = 30 * sy;
    const rx = 58 * sx;
    const ru = 20 * sy;
    const drift = coreT;
    const swell = 1 + thinkK * 1.2;
    for (let i = 0; i < CORE_N; i++) {
      const th = (i / CORE_N) * TAU;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const r =
        1 +
        (0.05 * Math.sin(2 * th + drift) + 0.05 * Math.sin(3 * th - drift * 1.4) + 0.03 * Math.sin(5 * th + drift * 0.7)) *
          swell;
      const bump =
        s > 0 ? 0.5 * Math.exp(-Math.pow((th - 1.25) / 0.5, 2)) + 0.28 * Math.exp(-Math.pow((th - 2.2) / 0.34, 2)) : 0;
      const t = clamp((cu + ru * s) / (H * sy), 0, 1);
      corePts[i * 2] = CX + Cx.x + L.x * pow(t, 1.35) * 0.9 + rx * r * c;
      corePts[i * 2 + 1] = GROUND - (cu + ru * r * s * (1 + bump)) + Cy.x;
    }
    return closedPath(corePts, CORE_N);
  }

  function lashPath(e: number[]) {
    const a = e[7];
    if (a < 0.04) return "";
    let d = "";
    const spots = [0.64, 0.78, 0.92];
    const sizes = [3.8, 4.8, 4];
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 3; k++) {
        const t = spots[k];
        const m = 1 - t;
        const x = m * m * e[0] + 2 * m * t * e[2] + t * t * e[4];
        const y = m * m * e[1] + 2 * m * t * e[3] + t * t * e[5];
        const tx = 2 * m * (e[2] - e[0]) + 2 * t * (e[4] - e[2]);
        const ty = 2 * m * (e[3] - e[1]) + 2 * t * (e[5] - e[3]);
        const l = Math.sqrt(tx * tx + ty * ty) || 1;
        let nx = ty / l;
        let ny = -tx / l;
        // Ресницы торчат от середины дуги и чуть наружу.
        const mid = (e[1] + e[5]) / 2;
        if ((e[3] - mid) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        const len = sizes[k] * a;
        nx += 0.34;
        const lift = -side * eyeSkew;
        d += `M${n1(side * x)} ${n1(y + lift)}L${n1(side * (x + nx * len))} ${n1(y + ny * len + lift)}`;
      }
    }
    return d;
  }

  /* Брызги, сердечки и буквы «з»: короткоживущие частицы в отдельной группе. */
  const fx: Particle[] = [];
  function addFx(kind: Particle["kind"], x: number, y: number, vx: number, vy: number, life: number, size: number) {
    let node: SVGElement;
    if (kind === "drop") {
      node = document.createElementNS(SVGNS, "circle");
      node.setAttribute("class", "m-drop");
      node.setAttribute("r", String(size));
    } else if (kind === "heart") {
      node = document.createElementNS(SVGNS, "path");
      node.setAttribute("class", "m-heart");
      node.setAttribute(
        "d",
        "M0 3.2C-1.2 1.4-3.6 .4-3.6-1.5-3.6-2.9-2.5-3.6-1.5-3.6-.8-3.6-.3-3.2 0-2.6 .3-3.2.8-3.6 1.5-3.6 2.5-3.6 3.6-2.9 3.6-1.5 3.6 .4 1.2 1.4 0 3.2Z",
      );
    } else {
      node = document.createElementNS(SVGNS, "text");
      node.setAttribute("class", "m-z");
      node.textContent = stage?.sleepGlyph ?? "з";
    }
    el.fx.appendChild(node);
    fx.push({ kind, node, x, y, vx, vy, t: 0, life, size });
  }
  function stepFx(dt: number) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      if (f.t >= f.life) {
        el.fx.removeChild(f.node);
        fx.splice(i, 1);
        continue;
      }
      const k = f.t / f.life;
      if (f.kind === "drop") {
        f.vy += 620 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.node.setAttribute("cx", String(n1(f.x)));
        f.node.setAttribute("cy", String(n1(f.y)));
        f.node.setAttribute("opacity", String(n1(1 - k * k)));
      } else {
        f.x += (f.vx + Math.sin(f.t * 3.2) * 9) * dt;
        f.y += f.vy * dt;
        const scale = f.size * (0.7 + 0.5 * Math.min(1, k * 3));
        f.node.setAttribute("transform", `translate(${n1(f.x)} ${n1(f.y)}) scale(${n1(scale)})`);
        f.node.setAttribute("opacity", String(n1(k < 0.2 ? k * 5 : 1 - (k - 0.2) / 0.8)));
      }
    }
  }

  /* Действия */
  let act: Action | null = null;
  let airborne = false;
  let dragging = false;
  let lookX = 0;
  let lookY = 0;
  let pointerAt = -99;
  let wanderAt = 0;
  let wanderX = 0;
  let wanderY = 0;
  let lastInput = 0;
  let asleep = false;
  let nextBlink = 2;
  let nextIdle = 9;
  let zAt = 0;
  let focusMode = false;
  let pressed = false;
  let hoverOn = false;

  function impulse(power: number) {
    wave.a = Math.min(7, wave.a + power);
  }

  /* Без анимации: выражение меняется сразу и через секунду возвращается */
  let stillTimer: ReturnType<typeof setTimeout> | undefined;
  function still(name: MascotExpression, seconds?: number) {
    eye = EX[name].slice();
    render();
    if (stillTimer) clearTimeout(stillTimer);
    stillTimer = setTimeout(() => {
      eye = EX[exprBase].slice();
      render();
    }, (seconds || 1) * 1000);
  }

  function hop(power = 1, kind?: "quiet") {
    if (reduced) {
      if (kind !== "quiet") still("happy", 1);
      return;
    }
    if (airborne || dragging || act?.type === "hop") return;
    act = { type: "hop", t: 0, power, wait: 0.1 + 0.05 * power };
    S.to = -0.1 - 0.09 * power;
    if (kind !== "quiet") setExpr("happy", 0.9);
  }

  function wiggle() {
    if (reduced || airborne || dragging) return;
    act = { type: "wiggle", t: 0, step: 0 };
  }

  function stretchUp() {
    if (reduced || airborne || dragging) return;
    act = { type: "stretch", t: 0 };
    setExpr("happy", 0.8);
  }

  function land(speed: number) {
    airborne = false;
    pos.y = 0;
    pos.vy = 0;
    S.v -= speed * 0.0125;
    impulse(speed * 0.011);
    Fy.v += speed * 0.26;
    Gy.v += speed * 0.18;
    Cy.v += speed * 0.4;
    Rt.v += rnd(-1, 1) * speed * 0.06;
    if (speed > 230) {
      const count = speed > 340 ? 4 : 3;
      for (let i = 0; i < count; i++) {
        const side = i % 2 ? 1 : -1;
        addFx(
          "drop",
          CX + pos.x + side * rnd(44, 72),
          GROUND - rnd(2, 9),
          side * rnd(26, 76),
          -rnd(70, 150),
          rnd(0.42, 0.62),
          rnd(1.6, 3),
        );
      }
    }
  }

  function behave(dt: number) {
    /* Настроение и короткие реакции */
    if (exprNow && T > exprUntil) exprNow = null;
    let name: MascotExpression = exprNow || (asleep ? "sleep" : thinking ? "think" : exprBase);
    if (T < blinkUntil && !exprNow && !asleep) name = "blink";
    const target = EX[name] || EX.calm;
    const rate = 1 - Math.exp(-dt * 17);
    for (let i = 0; i < eye.length; i++) eye[i] += (target[i] - eye[i]) * rate;

    /* Дыхание: у спящего медленнее и глубже */
    const breath = asleep
      ? 0.03 * Math.sin((T * TAU) / 4.6)
      : 0.013 * Math.sin((T * TAU) / 3.3) + 0.005 * Math.sin((T * TAU) / 7.7);
    if (act?.type !== "hop") {
      S.to =
        breath +
        (pressed ? -0.15 : 0) +
        (hoverOn && !pressed && !asleep ? 0.035 : 0) +
        thinkK * (0.016 + 0.018 * Math.sin((T * TAU) / 1.6));
    }

    /* Взгляд: за курсором, а без него по сторонам */
    if (T - pointerAt > 3.5) {
      if (T > wanderAt) {
        wanderAt = T + rnd(1.6, 5.2);
        const pick = Math.random();
        wanderX = pick < 0.34 ? 0 : pick < 0.8 ? rnd(-1, -0.25) : rnd(0.2, 0.7);
        wanderY = rnd(-0.5, 0.4);
      }
      if (!asleep) {
        lookX = wanderX;
        lookY = wanderY;
      } else {
        lookX = 0;
        lookY = 0.3;
      }
    }
    /* Думает: поднял глаза, смотрит то в одну сторону, то в другую, ядро внутри перемешивается */
    thinkK += ((thinking ? 1 : 0) - thinkK) * (1 - Math.exp(-dt * 5));
    eyeSkew += (thinkK * thinkSide * 1.5 - eyeSkew) * (1 - Math.exp(-dt * 6));
    if (thinking) {
      lastInput = T;
      if (T > thinkTurn) {
        thinkTurn = T + rnd(1.1, 2);
        thinkSide = -thinkSide;
        impulse(0.5);
      }
      lookX = thinkSide * 0.7;
      lookY = -0.95;
    }
    const focusDamp = focusMode ? 0.35 : 1;
    Fx.to = lookX * 9.5 * focusDamp;
    Fy.to = lookY * 4.5 * focusDamp - thinkK * 2;
    Gx.to = -lookX * 3;
    Gy.to = -lookY * 2;
    Cx.to = lookX * 2.6 + thinkK * Math.cos(T * 2.3) * 7;
    Cy.to = lookY * 1.6 + thinkK * Math.sin(T * 2.3) * 3.5;
    Rt.to = lookX * 3.4 * focusDamp + L.x * 0.2 + thinkK * thinkSide * 4;
    L.to = dragging ? 0 : Math.sin(T * 0.67) * 1.3 + lookX * 4.4 * focusDamp + thinkK * thinkSide * 3;

    /* Моргание: иногда дважды */
    if (T > nextBlink && !asleep) {
      blinkUntil = T + 0.09;
      nextBlink = T + (Math.random() < 0.2 ? 0.24 : rnd(2.4, 6.2));
    }

    /* Простой: то подпрыгнет, то потянется, то поёрзает */
    if (T > nextIdle && !asleep && !focusMode && !thinking && !act && !airborne && !dragging && !pressed) {
      nextIdle = T + rnd(9, 22);
      const pickIdle = Math.random();
      if (pickIdle < 0.4) hop(0.55, "quiet");
      else if (pickIdle < 0.72) wiggle();
      else stretchUp();
    }

    /* Засыпает, если долго ничего не происходит */
    if (!asleep && !focusMode && T - lastInput > 42 && !act && !airborne) {
      asleep = true;
      zAt = T + 0.6;
    }
    if (asleep && T > zAt) {
      zAt = T + rnd(1.7, 2.6);
      addFx("z", CX + pos.x + 40 + rnd(-4, 6), GROUND - H - 2, rnd(2, 8), -16, 2.6, rnd(0.8, 1.05));
    }

    /* Сценарии */
    if (act) {
      act.t += dt;
      if (act.type === "hop") {
        if (act.t >= act.wait) {
          const p = act.power;
          airborne = true;
          pos.vy = 215 + 165 * p;
          S.v += 2 + 2.3 * p;
          Fy.v += 40 * p;
          Cy.v += 110 * p;
          impulse(1.1 * p);
          act = null;
        }
      } else if (act.type === "wiggle") {
        const beat = Math.floor(act.t / 0.13);
        if (beat > act.step) {
          act.step = beat;
          if (beat <= 4) {
            L.v += (beat % 2 ? 1 : -1) * 92;
            impulse(0.5);
            S.v -= 0.5;
          } else {
            act = null;
          }
        }
      } else if (act.t < 0.34) {
        S.to = 0.13 + breath;
      } else {
        impulse(0.8);
        act = null;
      }
    }
  }

  function physics(dt: number) {
    /* Полёт */
    if (airborne && !dragging) {
      pos.vy -= 980 * dt;
      // На сцене слайм падает с высоты, а не с прыжка: без предела скорости он
      // расплющился бы в блин. В приложении так высоко он не бывает.
      if (stage && pos.vy < -TERMINAL_SPEED) pos.vy = -TERMINAL_SPEED;
      pos.y += pos.vy * dt;
      S.to = clamp(Math.abs(pos.vy) * 0.00062, 0, 0.2);
      L.v += -Hx.v * 0.05 * dt;
      if (pos.y <= 0) land(-pos.vy);
    }
    /* Перетаскивание: тело догоняет палец на пружине */
    if (dragging) {
      const ax = (Hx.to - pos.x) * 260 - Hx.v * 26;
      Hx.v += ax * dt;
      pos.x += Hx.v * dt;
      const ay = (Hy.to - pos.y) * 260 - Hy.v * 26;
      Hy.v += ay * dt;
      pos.y += Hy.v * dt;
      L.to = clamp(-Hx.v * 0.05, -26, 26);
      S.to = clamp(Math.abs(Hy.v) * 0.0009 + 0.09, 0, 0.3);
    } else if (Math.abs(pos.x) > 0.05 || Math.abs(Hx.v) > 0.5) {
      /* Отпустили: сама возвращается на своё место */
      Hx.v += (-pos.x * 26 - Hx.v * 6.6) * dt;
      pos.x += Hx.v * dt;
      L.v += -Hx.v * 0.02 * dt * 60;
    }
    for (const s of springs) {
      s.v += (-s.k * (s.x - s.to) - s.c * s.v) * dt;
      s.x += s.v * dt;
    }
    const r = airborne || dragging ? 1 : 0;
    round += (r - round) * (1 - Math.exp(-dt * (r ? 13 : 30)));
    wave.a *= Math.exp(-dt * 4.1);
    wave.ph += dt * 13.5;
  }

  function step(dt: number) {
    T += dt;
    coreT += dt * (0.5 + thinkK * 2.4);
    behave(dt);
    let left = dt;
    while (left > 0.0001) {
      const h = Math.min(left, 1 / 120);
      physics(h);
      left -= h;
    }
    stepFx(dt);
  }

  function render() {
    const sy = 1 + S.x;
    const sx = 1 / (1 + 0.86 * S.x);
    bodyPoints(sx, sy);
    const d = closedPath(pts, N);
    el.body.setAttribute("d", d);
    el.clip.setAttribute("d", d);
    el.lit.setAttribute("d", d);
    el.lit.setAttribute("transform", `translate(${n1(-3.5 + Gx.x * 0.4)} ${n1(-5.5 + Gy.x * 0.3)})`);
    el.core.setAttribute("d", corePath(sx, sy));
    /* Светлая кромка у самого низа: отражение от стекла под ним */
    const rimU = 21 * sy;
    const rimT = pow(rimU / (H * sy), 1.35);
    const rx0 = CX + L.x * rimT + 34 * sx;
    const rx1 = CX + L.x * rimT + 68 * sx;
    el.rim.setAttribute(
      "d",
      `M${n1(rx0)} ${n1(GROUND - 9)}Q${n1((rx0 + rx1) / 2 + 9)} ${n1(GROUND - 8)} ${n1(rx1)} ${n1(GROUND - rimU - 3)}`,
    );

    const gt = pow((86 * sy) / (H * sy), 1.35);
    el.gloss.setAttribute(
      "transform",
      `translate(${n1(CX + L.x * gt + Gx.x)} ${n1(GROUND + Gy.x)}) scale(${n1(sx * 100) / 100} ${n1(sy * 100) / 100})`,
    );

    const ft = pow(FACE / H, 1.35);
    el.face.setAttribute(
      "transform",
      `translate(${n1(CX + L.x * (ft + 0.28) + Fx.x)} ${n1(GROUND - FACE * sy + Fy.x)}) rotate(${n1(Rt.x)}) scale(${n1(sx * 100) / 100} ${n1(sy * 100) / 100})`,
    );

    el.eyeR.setAttribute("d", eyePath(1, eye));
    el.eyeL.setAttribute("d", eyePath(-1, eye));
    el.eyeR.setAttribute("transform", `translate(0 ${n1(-eyeSkew)})`);
    el.eyeL.setAttribute("transform", `translate(0 ${n1(eyeSkew)})`);
    el.lash.setAttribute("d", lashPath(eye));
    el.blush.setAttribute("opacity", String(n1(eye[8])));
    el.mouth.setAttribute("d", `M-4.6 16Q0 ${n1(16 + eye[9])} 4.6 16`);
    el.mouth.setAttribute("opacity", String(n1(eye[10])));
    el.mouth.setAttribute("transform", `translate(${n1(eyeSkew * 1.4)} 0)`);
    el.o.setAttribute("opacity", String(n1(eye[11])));

    el.all.setAttribute("transform", `translate(${n1(pos.x)} ${n1(-pos.y)})`);
    const k = 1 / (1 + Math.max(0, pos.y) / 62);
    el.floor.setAttribute("cx", String(n1(CX + pos.x)));
    el.floor.setAttribute("rx", String(n1(76 * sx * (0.55 + 0.45 * k))));
    el.floor.setAttribute("opacity", String(n1(0.25 + 0.75 * k)));
    el.aura.setAttribute("cx", String(n1(CX + pos.x)));
    el.aura.setAttribute("cy", String(n1(140 - pos.y)));
  }

  /* Реакции на человека */
  function touched() {
    lastInput = T;
    if (asleep) {
      asleep = false;
      setExpr("wow", 0.5);
      nextBlink = T + 0.6;
      S.v += 2.4;
      impulse(1.4);
    }
  }

  function unitsPerPixel() {
    const box = art.getBoundingClientRect();
    return viewWidth / (box.width || 124);
  }

  /* Сцена считает кадры, только пока слайм на экране. В приложении он виден всегда. */
  let onScreen = !stage;

  let lastMoveX = 0;
  let lastDir = 0;
  let turns = 0;
  let turnAt = 0;
  const onPointerMove = (event: PointerEvent) => {
    // Слайм за экраном не следит за курсором: незачем мерить его рамку на каждое движение.
    if (!onScreen) return;
    touched();
    pointerAt = T;
    const box = art.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height * 0.6);
    lookX = clamp(dx / 320, -1, 1);
    lookY = clamp(dy / 260, -1, 1);
    if (hoverOn && !pressed) {
      const dir = event.clientX - lastMoveX > 0 ? 1 : -1;
      if (dir !== lastDir && Math.abs(event.clientX - lastMoveX) > 1) {
        if (T - turnAt > 0.9) turns = 0;
        turns++;
        turnAt = T;
        lastDir = dir;
        if (turns >= 4) {
          /* Гладят: щурится и пускает сердечко */
          turns = 0;
          setExpr("happy", 1.3);
          addFx("heart", CX + rnd(-34, 34), GROUND - H - 4, rnd(-6, 6), -30, 1.3, rnd(1.5, 2.1));
          S.v += 1.2;
        }
      }
      lastMoveX = event.clientX;
    }
  };

  let lastScroll = stage ? window.scrollY : 0;
  function scrolled(now: number) {
    touched();
    const delta = clamp(now - lastScroll, -90, 90);
    lastScroll = now;
    if (reduced || airborne || dragging) return;
    /* Страница уехала, а желе ещё догоняет */
    Cy.v -= delta * 3.4;
    Fy.v -= delta * 1.5;
    S.v += Math.abs(delta) * 0.012 * (delta > 0 ? -1 : 1);
    impulse(Math.abs(delta) * 0.012);
  }
  // Страница скроллится внутри своей колонки, поэтому слушаем с погружением: scroll не всплывает.
  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("main")) return;
    scrolled(target.scrollTop);
  };
  // На сцене листается сама страница.
  const onPageScroll = () => {
    if (!onScreen) {
      lastScroll = window.scrollY;
      return;
    }
    scrolled(window.scrollY);
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("keydown", touched);
  if (stage) window.addEventListener("scroll", onPageScroll, { passive: true });
  else document.addEventListener("scroll", onScroll, { passive: true, capture: true });

  const onEnter = () => {
    hoverOn = true;
    if (!reduced) {
      setExpr("happy", 0.8);
      S.v += 1.1;
    }
  };
  const onLeave = () => {
    hoverOn = false;
  };

  let downX = 0;
  let downY = 0;
  let moved = false;
  let activeId: number | null = null;
  const onDown = (event: PointerEvent) => {
    if (event.button) return;
    touched();
    pressed = true;
    moved = false;
    activeId = event.pointerId;
    downX = event.clientX;
    downY = event.clientY;
    try {
      hit?.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже ушёл: перетаскивание просто не начнётся.
    }
    setExpr("squeeze", 30);
  };
  const onDrag = (event: PointerEvent) => {
    if (!pressed || event.pointerId !== activeId || reduced) return;
    // На сцене палец листает страницу, а не тащит слайм.
    if (stage && event.pointerType !== "mouse") return;
    const dx = event.clientX - downX;
    const dy = event.clientY - downY;
    if (!moved && Math.sqrt(dx * dx + dy * dy) > 7) {
      moved = true;
      dragging = true;
      airborne = false;
      act = null;
      Hx.v = 0;
      Hy.v = 0;
      pos.vy = 0;
      hideBubble();
    }
    if (dragging) {
      const u = unitsPerPixel();
      Hx.to = dx * u;
      Hy.to = Math.max(0, -dy * u) + 12;
      setExpr(Math.abs(Hx.v) + Math.abs(Hy.v) > 420 ? "squeeze" : "sad", 30);
    }
  };
  const release = (event: PointerEvent) => {
    if (!pressed || event.pointerId !== activeId) return;
    pressed = false;
    activeId = null;
    exprNow = null;
    if (dragging) {
      dragging = false;
      airborne = pos.y > 0.5;
      pos.vy = clamp(Hy.v * 0.6, -300, 460);
      setExpr("wow", 0.5);
    }
  };
  const onClick = () => {
    if (moved) {
      moved = false;
      return;
    }
    hop(1);
    if (!stage) say();
  };
  if (hit) {
    hit.addEventListener("pointerenter", onEnter);
    hit.addEventListener("pointerleave", onLeave);
    hit.addEventListener("pointerdown", onDown);
    hit.addEventListener("pointermove", onDrag);
    hit.addEventListener("pointerup", release);
    hit.addEventListener("pointercancel", release);
    hit.addEventListener("click", onClick);
  }

  /*
   * Реплика и плашка есть только в приложении. На сцене тех же узлов в документе нет:
   * они создаются отдельно и никуда не вставляются, так что код ниже пишет в них, никому
   * не мешая, а в приложении работает ровно как раньше.
   */
  function shellPart(selector: string, markup: string): HTMLElement {
    const found = host.querySelector<HTMLElement>(selector);
    if (found) return found;
    const holder = document.createElement("div");
    holder.innerHTML = markup;
    return holder.firstElementChild as HTMLElement;
  }

  /* Реплика на случай, если нужна помощь: только по нажатию, сама не лезет */
  const bubble = shellPart(
    ".mascot-bubble",
    '<div class="mascot-bubble is-off"><p class="mascot-say"></p><button class="mascot-ask" type="button"></button></div>',
  );
  const sayEl = bubble.querySelector<HTMLElement>(".mascot-say")!;
  const askEl = bubble.querySelector<HTMLElement>(".mascot-ask")!;
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  function hideBubble() {
    bubble.classList.add("is-off");
    if (bubbleTimer) clearTimeout(bubbleTimer);
  }
  function say(text?: string) {
    if (thinking) return;
    sayEl.textContent = text || LINES[view] || DEFAULT_LINE;
    askEl.classList.toggle("is-off", view === "chat" || view === "board");
    bubble.classList.remove("is-off");
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, 6500);
  }
  const onDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element && !target.closest(".mascot-hit") && !bubble.classList.contains("is-off")) {
      hideBubble();
    }
  };
  if (!stage) document.addEventListener("click", onDocumentClick);

  /* Плашка над головой: над чем думает и что делает прямо сейчас */
  const thoughts = shellPart(
    ".m-thoughts",
    '<div class="m-thoughts" data-state="off"><p class="m-card-title"><span></span></p><p class="m-card-step"></p></div>',
  );
  const cardTitle = thoughts.querySelector<HTMLElement>(".m-card-title span")!;
  const cardStep = thoughts.querySelector<HTMLElement>(".m-card-step")!;
  let cardTimer: ReturnType<typeof setTimeout> | undefined;
  let cardHidden = false;
  let stopHandler: (() => void) | null = null;
  let remindGo: (() => void) | null = null;

  function hideCard() {
    if (cardTimer) clearTimeout(cardTimer);
    if (thoughts.dataset.state === "off") return;
    if (reduced) {
      thoughts.dataset.state = "off";
      delete thoughts.dataset.long;
      return;
    }
    thoughts.dataset.state = "away";
    cardTimer = setTimeout(() => {
      thoughts.dataset.state = "off";
      delete thoughts.dataset.long;
    }, 240);
  }
  function stepLine(text: string, shine: boolean) {
    const old = cardStep.lastElementChild;
    if (old) {
      old.classList.add("out");
      setTimeout(() => old.remove(), reduced ? 0 : 240);
    }
    const line = document.createElement("span");
    if (shine) line.className = "shine";
    line.textContent = text;
    cardStep.appendChild(line);
  }
  function thinkStart(title: string, onStop?: () => void) {
    if (cardTimer) clearTimeout(cardTimer);
    thinking = true;
    cardHidden = false;
    stopHandler = onStop ?? null;
    delete thoughts.dataset.long;
    cardTitle.textContent = title;
    cardStep.textContent = "";
    thoughts.dataset.state = "work";
    hideBubble();
    touched();
    if (reduced) {
      eye = EX.think.slice();
      render();
    }
  }
  function thought(text: string) {
    stepLine(text, true);
    if (!reduced) {
      S.v += 1.6;
      impulse(0.6);
    }
  }
  function remind(title: string, text: string, go: () => void, options: { long?: boolean; stay?: boolean } = {}) {
    if (thinking) return;
    if (cardTimer) clearTimeout(cardTimer);
    remindGo = go;
    cardHidden = false;
    if (options.long) thoughts.dataset.long = "true";
    else delete thoughts.dataset.long;
    cardTitle.textContent = title;
    cardStep.textContent = "";
    stepLine(text, false);
    thoughts.dataset.state = "remind";
    // Сам не висит вечно: через четверть минуты уходит, ты уже видел.
    if (!options.stay) cardTimer = setTimeout(hideCard, 15000);
    hideBubble();
    touched();
    if (!reduced) {
      S.v += 1.6;
      impulse(0.8);
      hop(0.4, "quiet");
    }
  }
  function thinkEnd(ready?: string) {
    thinking = false;
    stopHandler = null;
    if (reduced) {
      eye = EX[exprBase].slice();
      render();
    }
    if (!ready || cardHidden) {
      hideCard();
      return;
    }
    stepLine(ready, false);
    thoughts.dataset.state = "done";
    cardTimer = setTimeout(hideCard, 2400);
    if (!reduced) {
      setExpr("happy", 0.9);
      hop(0.38, "quiet");
    }
  }
  const onCardClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".m-card-go") || (thoughts.dataset.long && target.closest(".m-card-text"))) {
      hideCard();
      remindGo?.();
    } else if (target.closest(".m-card-x")) {
      cardHidden = true;
      hideCard();
    } else if (target.closest(".m-card-stop")) {
      const stop = stopHandler;
      thinkEnd();
      stop?.();
    }
  };
  thoughts.addEventListener("click", onCardClick);

  /* Покадровый цикл; на скрытой вкладке браузер сам его останавливает */
  let last = 0;
  let frameId = 0;
  function frame(now: number) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (stage) {
      stageFrame(dt);
      return;
    }
    // На странице чата маскот скрыт, и считать его кадры незачем
    if (view !== "chat") {
      step(dt);
      render();
    }
    frameId = requestAnimationFrame(frame);
  }

  /*
   * Сцена. Падающий слайм первые доли секунды висит над местом невидимым (CSS прячет
   * его, пока нет data-ready), потом летит вниз и шлёпается. Кадры идут, только пока он
   * на экране: за экраном его часы стоят, и нагонять там нечего.
   */
  let hold = 0;
  if (stage?.drop && !reduced) {
    airborne = true;
    pos.y = DROP_HEIGHT;
    pos.vy = 0;
    hold = DROP_HOLD;
  } else if (stage) {
    host.dataset.ready = "true";
  }
  function stageFrame(dt: number) {
    frameId = 0;
    if (hold > 0) {
      hold -= dt;
    } else {
      if (!host.dataset.ready) host.dataset.ready = "true";
      step(dt);
      render();
    }
    if (onScreen && !document.hidden) frameId = requestAnimationFrame(frame);
  }
  function resume() {
    if (reduced || frameId || !onScreen || document.hidden) return;
    last = 0;
    frameId = requestAnimationFrame(frame);
  }
  let watcher: IntersectionObserver | null = null;
  if (stage) {
    // С небольшим запасом: слайм оживает чуть раньше, чем въедет в кадр.
    watcher = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        resume();
      },
      { rootMargin: "60px 0px" },
    );
    watcher.observe(host);
    document.addEventListener("visibilitychange", resume);
  }

  render();
  if (!reduced && !stage) frameId = requestAnimationFrame(frame);

  return {
    hop,
    wiggle,
    say,
    thinkStart,
    thought,
    thinkEnd,
    remind,
    remindOff: () => {
      if (thoughts.dataset.state === "remind") hideCard();
    },
    hideCard: () => {
      cardHidden = true;
      hideCard();
    },
    mood: (name) => setExpr(name),
    react: (name, seconds) => {
      if (reduced) still(name, seconds);
      else setExpr(name, seconds || 1);
    },
    focus: (on) => {
      focusMode = on;
      setExpr(on ? "sharp" : "calm");
      touched();
      if (reduced) {
        eye = EX[exprBase].slice();
        render();
      }
    },
    setView: (next) => {
      view = next;
    },
    destroy: () => {
      cancelAnimationFrame(frameId);
      watcher?.disconnect();
      document.removeEventListener("visibilitychange", resume);
      if (stillTimer) clearTimeout(stillTimer);
      if (bubbleTimer) clearTimeout(bubbleTimer);
      if (cardTimer) clearTimeout(cardTimer);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", touched);
      window.removeEventListener("scroll", onPageScroll);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("click", onDocumentClick);
      if (hit) {
        hit.removeEventListener("pointerenter", onEnter);
        hit.removeEventListener("pointerleave", onLeave);
        hit.removeEventListener("pointerdown", onDown);
        hit.removeEventListener("pointermove", onDrag);
        hit.removeEventListener("pointerup", release);
        hit.removeEventListener("pointercancel", release);
        hit.removeEventListener("click", onClick);
      }
      thoughts.removeEventListener("click", onCardClick);
    },
  };
}
