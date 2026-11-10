// Собирает данные публичного демо из съёмки локального стенда.
//
// usage: node scripts/demo/build-fixtures.mjs <capture.json> [public/demo/fixtures.json]
//
// Съёмку делает scripts/demo/capture.mjs: headless Chrome заходит на стенд демо гостем
// (бэкенд с DEMO_MODE=true, фронтенд демо), обходит разделы и записывает ответы API.
// Здесь из неё остаётся по одному ответу на каждый GET, блоки учёбы сливаются в один
// список, а недели дневника раскладываются по понедельникам. Адрес гостя заменяется
// на постоянный, чтобы в данных не было случайных идентификаторов.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [input, output = "public/demo/fixtures.json"] = process.argv.slice(2);
if (!input) {
  console.error("usage: node scripts/demo/build-fixtures.mjs <capture.json> [out.json]");
  process.exit(1);
}

const capture = JSON.parse(readFileSync(input, "utf8"));
const DEMO_EMAIL = "aliya@demo.timely-plan.study";

let raw = JSON.stringify(capture.entries);
raw = raw.replace(/visitor-[0-9a-f-]{8,64}@demo\.timely-plan\.study/g, DEMO_EMAIL);
const entries = JSON.parse(raw);

const backendOrigin = new URL(capture.meta.backend).origin;
const get = {};
const blocks = new Map();
const diaryWeeks = {};
let skipped = 0;

for (const entry of entries) {
  if (entry.method !== "GET" || entry.body == null || entry.status >= 400) {
    skipped += 1;
    continue;
  }
  let body;
  try {
    body = JSON.parse(entry.body);
  } catch {
    skipped += 1;
    continue;
  }
  const url = new URL(entry.url);
  const scope = url.origin === backendOrigin ? "B" : "A";
  const path = url.pathname;

  if (scope === "B" && path === "/api/learning-blocks/") {
    for (const block of Array.isArray(body) ? body : body.results ?? []) blocks.set(block.id, block);
    continue;
  }
  if (scope === "A" && path === "/api/diary/week" && body && body.weekStart) {
    diaryWeeks[body.weekStart] = body;
    continue;
  }
  // Последний ответ на тот же адрес главнее: он снят позже.
  get[`${scope} ${path}${url.search}`] = { status: entry.status, body };
}

const capturedAt = new Date(capture.meta.capturedAt);
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: capture.meta.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(capturedAt);

const fixtures = {
  meta: {
    capturedAt: capture.meta.capturedAt,
    timeZone: capture.meta.timeZone,
    today,
    email: DEMO_EMAIL,
  },
  get,
  blocks: [...blocks.values()].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at))),
  diaryWeeks,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(fixtures));
console.log(
  `fixtures: ${Object.keys(get).length} GET responses, ${fixtures.blocks.length} blocks,`,
  `${Object.keys(diaryWeeks).length} diary weeks (${Object.keys(diaryWeeks).join(", ")}),`,
  `today ${today}, skipped ${skipped}; ${(JSON.stringify(fixtures).length / 1024).toFixed(0)} KB -> ${output}`,
);
