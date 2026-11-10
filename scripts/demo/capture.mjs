// Снимает ответы API, которые получает приложение демо-гостя на локальном стенде.
// usage: node capture-demo.mjs <out.json>
// Стенд: фронтенд демо на http://demo.localhost:3340, бэкенд на http://127.0.0.1:8140.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
const APP = "http://demo.localhost:3340";
const BACKEND = "http://127.0.0.1:8140";
const PORT = 9300 + Math.floor(Math.random() * 500);
const W = 1440;
const H = 900;

const profile = mkdtempSync(join(tmpdir(), "cdp-capture-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${W},${H}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let seq = 0;
const pending = new Map();
const listeners = [];
function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const requests = new Map(); // requestId -> {method, url, postData}
const captured = [];
const bodyJobs = [];

function interesting(url) {
  if (url.startsWith(BACKEND + "/")) return true;
  if (!url.startsWith(APP + "/api/")) return false;
  return !url.startsWith(APP + "/api/auth/");
}

try {
  let version;
  for (let i = 0; i < 80; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      break;
    } catch {
      await sleep(100);
    }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let sessionId;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    if (!msg.method) return;
    if (msg.method === "Network.requestWillBeSent") {
      const { requestId, request } = msg.params;
      if (interesting(request.url)) {
        requests.set(requestId, { method: request.method, url: request.url, postData: request.postData ?? null });
      }
    } else if (msg.method === "Network.responseReceived") {
      const req = requests.get(msg.params.requestId);
      if (req) {
        req.status = msg.params.response.status;
        req.mime = msg.params.response.mimeType;
      }
    } else if (msg.method === "Network.loadingFinished") {
      const req = requests.get(msg.params.requestId);
      if (req && req.method !== "OPTIONS") {
        bodyJobs.push(
          send("Network.getResponseBody", { requestId: msg.params.requestId }, sessionId)
            .then((b) => captured.push({ ...req, body: b.base64Encoded ? null : b.body }))
            .catch(() => captured.push({ ...req, body: null })),
        );
      }
    }
    for (const l of listeners) l(msg);
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
  const s = (m, p) => send(m, p, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Network.enable", { maxTotalBufferSize: 200_000_000, maxResourceBufferSize: 50_000_000 });
  await s("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await s("Emulation.setTimezoneOverride", { timezoneId: "Asia/Almaty" });
  const ua = (await s("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true })).result.value;
  await s("Network.setUserAgentOverride", { userAgent: ua.replace("HeadlessChrome", "Chrome"), acceptLanguage: "ru-RU,ru;q=0.9" });
  // Тур не нужен: он только перекрывает страницы.
  await s("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('timely.demo.lang','ru')}catch(e){}" });

  const evaluate = async (expression) =>
    (await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

  async function visit(path, wait = 4500) {
    await s("Page.navigate", { url: APP + path });
    await sleep(wait);
    // Прокрутка вниз: часть данных грузится, когда блок попадает на экран.
    await evaluate("(async()=>{const m=document.querySelector('.main')||document.scrollingElement;for(let i=0;i<6;i++){m.scrollBy(0,700);await new Promise(r=>setTimeout(r,250))}m.scrollTo(0,0);return true})()");
    await sleep(800);
    const at = await evaluate("location.pathname+location.search");
    console.log("visited", path, "->", at, "| captured so far", requests.size);
  }

  // Вход гостем: /auth/demo заводит гостя и собирает ему неделю.
  await visit("/", 9000);
  for (const path of ["/plan", "/chat", "/weaknesses", "/pomodoro", "/goals", "/habits", "/curriculum", "/arena/solve", "/leaderboard", "/profile", "/settings"]) {
    await visit(path);
  }
  // Вкладка «Мои группы» в рейтинге.
  await visit("/leaderboard");
  await evaluate("(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/групп/i.test(x.textContent||''));b&&b.click();return !!b})()");
  await sleep(2500);

  // Каждый разговор тьютора.
  const chatIds = await evaluate(`(async()=>{const t=await (await fetch('/api/auth/backend-token')).json();const r=await fetch('${BACKEND}/api/curriculum/chats/',{headers:{Authorization:'Bearer '+t.token}});const j=await r.json();const rows=Array.isArray(j)?j:(j.results||[]);return rows.map(x=>x.id)})()`);
  console.log("chats", chatIds);
  for (const id of chatIds ?? []) await visit(`/chat?chat=${encodeURIComponent(id)}`, 4000);

  // Программы курсов: первые несколько ссылок со страницы библиотеки.
  await visit("/curriculum");
  const courseLinks = await evaluate("[...new Set([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>/curriculum\\//.test(h)))].slice(0,6)");
  console.log("course links", courseLinks);
  for (const href of courseLinks ?? []) await visit(href.replace(/^\/dashboard/, ""), 4000);

  await visit("/");
  await Promise.allSettled(bodyJobs);
  await sleep(500);
  await Promise.allSettled(bodyJobs);

  const meta = {
    capturedAt: new Date().toISOString(),
    timeZone: "Asia/Almaty",
    app: APP,
    backend: BACKEND,
  };
  writeFileSync(OUT, JSON.stringify({ meta, entries: captured }, null, 0));
  console.log("saved", captured.length, "responses to", OUT);
} finally {
  try {
    ws?.close();
  } catch {}
  chrome.kill("SIGKILL");
}
