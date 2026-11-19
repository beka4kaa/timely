# Навигация: короткая панель и выезжающее меню на телефоне — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Одна структура разделов для компьютера и телефона. Наверху всегда видны четыре пункта, остальное в трёх группах, которые раскрываются на месте. На телефоне нет нижней панели и нет вкладок сверху: левая панель выезжает по круглой кнопке или свайпу.

**Architecture:** Структура живёт в `src/config/dashboard-navigation.ts`. Разделы бывают двух видов: `page` (одна строка) и `group` (раскрывается). Состояние открытых групп и сигналы на строке группы — чистые функции в `src/lib/nav-groups.ts`. На телефоне до 640 px тот же `Sidebar` становится выезжающей панелью. Её открытость хранится в `DashboardShell`. Кнопка меню и жест — отдельные небольшие модули в `src/components/shell/`. `TabBar` и `SubNav` удаляются.

**Tech Stack:** Next.js 15, React, TypeScript, CSS в `src/styles/timely/` (подключение только через `index.css`), тесты `node --test` + `ts-node` (скрипт `npm run test:now`).

**Spec:** `docs/superpowers/specs/2026-11-19-navigation-design.md`. Правила вида — `DESIGN.md`.

## Global Constraints

- Телефонный вид — `@media (max-width: 640px)`, то же условие, что сейчас прячет панель (`ui.css:346`).
- Порядок всегда видимых пунктов: Сейчас `/dashboard`, Тьютор `/dashboard/chat`, Неделя `/dashboard/plan` (и `/dashboard/diary`), Помодоро `/dashboard/pomodoro`.
- Группы и пункты:
  - Учёба: Слабые темы `/dashboard/weaknesses`, `SECTION_LABEL` `/dashboard/curriculum`, Научная доска `/dashboard/whiteboard` только при `BOARD_ENABLED`;
  - Рост: Цели, Привычки;
  - Соревнования: Контесты `/dashboard/arena/solve`, Рейтинг `/dashboard/leaderboard`.
- Группы «Библиотека» нет. Названия групп — одно слово.
- Открытые группы хранятся в `localStorage` под ключом `timely-nav-groups`, одно состояние на компьютер и телефон. Без хранилища всё работает, просто не запоминает.
- Первый заход (в хранилище ничего нет): открыта только группа текущей страницы.
- Сигналы:
  - число тем на повторение и точка обработки книги видны на строке группы, пока группа свёрнута; когда раскрыта — у пунктов, как сейчас;
  - на кнопке меню сигналов нет.
- Кнопка меню: круглая стеклянная, 40 px, слева сверху с учётом `env(safe-area-inset-top/left)`. Остаётся на месте при прокрутке. `aria-label="Меню"`.
- Выезжающая панель:
  - ширина `min(80vw, 300px)`, справа затемнение `rgba(0, 0, 0, 0.42)`;
  - закрывается затемнением, свайпом влево, Escape и переходом на страницу;
  - страница под ней не прокручивается.
- Свайп открытия начинается не у самого края (x ≥ 20 px) и не над горизонтально прокручиваемой областью.
- В тьюторе панель открывается списком чатов, «‹ Чаты» ведёт в разделы (как сейчас `data-sb="chats"`).
- Анимации до 300 мс, `cubic-bezier(0.23, 1, 0.32, 1)`, без них при `prefers-reduced-motion`. Цвета только из токенов (`DESIGN.md`).
- Коммиты — только после «да» владельца (правило проекта). Шаги «Сохранить» ниже значат `git add` без коммита.

## Review Focus

1. Режим `nav-collapsed`, запомненный на компьютере, на телефоне не сжимает выезжающую панель до иконок: на телефоне видны подписи. Тест в задаче 4.
2. Свайп по неделе, году в помодоро или любой горизонтальной прокрутке не открывает меню. Тест в задаче 4.
3. Хранилище закрыто (приватный режим, `localStorage` бросает): группы всё равно раскрываются и сворачиваются. Тест в задаче 2.
4. Прямой заход на страницу свёрнутой группы (например `/dashboard/leaderboard`) без сохранённого состояния: группа раскрыта, пункт подсвечен. Тест в задаче 2 и проверка в задаче 3.
5. В чате на телефоне выбор чата из списка или «Новый чат» закрывает меню, и под ним не остаётся затемнения. Проверка в задаче 5.

---

### Task 1: Структура разделов: страницы и группы

**Files:**
- Modify: `src/config/dashboard-navigation.ts` (типы раздела, `dashboardSections`, `getDashboardNavigation`, `matchNavigation`)
- Test: `src/config/dashboard-navigation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DashboardSectionKey = "now" | "tutor" | "week" | "focus" | "study" | "growth" | "contests";
  export interface DashboardSection {
    key: DashboardSectionKey;
    kind: "page" | "group";
    title: string;
    icon: IconName;
    url: string;
    aliases?: readonly string[];        // только у page: прежние адреса, на которых горит
    items: DashboardNavigationItem[];  // у page пусто
  }
  export function getDashboardSections(access?): DashboardSection[]   // как сейчас
  export function getDashboardNavigation(access?): DashboardNavigationGroup[] // page → один пункт «сам»
  export function matchNavigation(pathname: string): NavigationMatch // page совпадает по url и aliases
  ```
  `DashboardView` и `dashboardViewOf` не меняются.

- [ ] **Step 1: Переписать тесты структуры** в `dashboard-navigation.test.ts`. Тесты «Библиотека» и «в учёбе одна неделя» заменяются на такие:
  ```ts
  test("разделы: четыре страницы, потом три группы", () => {
    const sections = getDashboardSections();
    assert.deepEqual(sections.map((s) => s.title), ["Сейчас", "Тьютор", "Неделя", "Помодоро", "Учёба", "Рост", "Соревнования"]);
    assert.deepEqual(sections.map((s) => s.kind), ["page", "page", "page", "page", "group", "group", "group"]);
  });
  test("в учёбе слабые темы и курсы, доска выключена", () => {
    const study = getDashboardSections().find((s) => s.key === "study");
    assert.deepEqual(study?.items.map((i) => i.url), ["/dashboard/weaknesses", "/dashboard/curriculum"]);
    assert.equal(study?.items[1].title, SECTION_LABEL);
  });
  test("страницы горят по своим и прежним адресам", () => {
    assert.deepEqual(matchNavigation("/dashboard/diary/schedule"), { section: "week", itemUrl: "/dashboard/plan" });
    assert.deepEqual(matchNavigation("/dashboard/pomodoro/history/2026-11-19"), { section: "focus", itemUrl: "/dashboard/pomodoro" });
    assert.deepEqual(matchNavigation("/dashboard/curriculum/plan/42"), { section: "study", itemUrl: "/dashboard/curriculum" });
    assert.deepEqual(matchNavigation("/dashboard/leaderboard"), { section: "contests", itemUrl: "/dashboard/leaderboard" });
    assert.equal(matchNavigation("/dashboard/profile").section, null);
  });
  test("плоское меню доски: у страницы один пункт — она сама", () => {
    const week = getDashboardNavigation().find((g) => g.label === "Неделя");
    assert.deepEqual(week?.items.map((i) => i.url), ["/dashboard/plan"]);
  });
  ```
  Тест «доска выключена: в панели только чат» удалить (у тьютора теперь нет пунктов). Остальные тесты файла оставить.

- [ ] **Step 2: Запустить и убедиться, что падают:** `npm run -s test:now 2>&1 | grep -E "^(✖|ℹ (pass|fail)))"`. Ожидается: `fail` больше 0 на новых тестах.

- [ ] **Step 3: Перестроить `dashboardSections`** по Global Constraints:
  - у `week` — `aliases: ["/dashboard/diary"]`;
  - доска в `study` последним пунктом при `BOARD_ENABLED`;
  - в `matchNavigation` для `kind: "page"` кандидаты — `[url, ...aliases]`, `itemUrl` — `url`;
  - обновить комментарий над `DashboardSection` (про телефон: «панель выезжает слева»).

- [ ] **Step 4: Запустить тесты:** `npm run -s test:now` → `fail 0`. И `npx tsc --noEmit`: ошибки допустимы только в `sidebar.tsx` и `tab-bar.tsx` (их чинят задачи 3 и 6) и уже известные (`pdfjs-dist`, `.next/types`).

- [ ] **Step 5: Сохранить:** `git add src/config/dashboard-navigation.ts src/config/dashboard-navigation.test.ts`

---

### Task 2: Открытые группы и сигналы на строке группы

**Files:**
- Create: `src/lib/nav-groups.ts`
- Test: `src/lib/nav-groups.test.ts` (добавить в скрипт `test:now` в `package.json`)

**Interfaces:**
- Consumes: `DashboardSection`, `DashboardSectionKey` из задачи 1.
- Produces:
  ```ts
  export const NAV_GROUPS_KEY = "timely-nav-groups";
  export function openGroupsFor(saved: readonly string[] | null, current: DashboardSectionKey | null, groups: readonly DashboardSectionKey[]): DashboardSectionKey[];
  export function toggleGroup(open: readonly DashboardSectionKey[], key: DashboardSectionKey): DashboardSectionKey[];
  export function groupSignal(section: DashboardSection, status: { dueReviews: number; ingesting: boolean }): { count: number | null; live: boolean };
  export function readOpenGroups(): string[] | null;   // null — нет записи, хранилище закрыто или мусор
  export function writeOpenGroups(open: readonly DashboardSectionKey[]): void; // молча, если хранилище закрыто
  ```

- [ ] **Step 1: Тесты:**
  ```ts
  const GROUPS = ["study", "growth", "contests"] as const;
  test("первый заход: открыта только группа текущей страницы", () => {
    assert.deepEqual(openGroupsFor(null, "contests", GROUPS), ["contests"]);
    assert.deepEqual(openGroupsFor(null, "focus", GROUPS), []);
  });
  test("запомненное плюс группа текущей страницы, без чужих ключей", () => {
    assert.deepEqual(openGroupsFor(["growth", "library"], "contests", GROUPS), ["growth", "contests"]);
  });
  test("переключение открывает и закрывает", () => {
    assert.deepEqual(toggleGroup(["growth"], "study"), ["growth", "study"]);
    assert.deepEqual(toggleGroup(["growth", "study"], "growth"), ["study"]);
  });
  test("сигнал группы: число повторений у учёбы, точка у книги", () => {
    const study = getDashboardSections().find((s) => s.key === "study")!;
    const growth = getDashboardSections().find((s) => s.key === "growth")!;
    assert.deepEqual(groupSignal(study, { dueReviews: 3, ingesting: true }), { count: 3, live: true });
    assert.deepEqual(groupSignal(study, { dueReviews: 0, ingesting: false }), { count: null, live: false });
    assert.deepEqual(groupSignal(growth, { dueReviews: 3, ingesting: true }), { count: null, live: false });
  });
  test("хранилище закрыто: чтение даёт null, запись не бросает", () => {
    const saved = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try {
      assert.equal(readOpenGroups(), null);
      assert.doesNotThrow(() => writeOpenGroups(["study"]));
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: saved });
    }
  });
  ```

- [ ] **Step 2: Запустить, убедиться, что падают** (`npm run -s test:now`, модуль не найден).

- [ ] **Step 3: Написать `src/lib/nav-groups.ts`.** Порядок в `openGroupsFor` — как в `saved`, текущая группа в конце, без повторов. `current` берётся, только если он есть в `groups`. Сигнал ищет пункты по адресам `/dashboard/weaknesses` и `/dashboard/curriculum`. `readOpenGroups` разбирает JSON-массив строк, на всё остальное отдаёт `null`.

- [ ] **Step 4: Запустить:** `npm run -s test:now` → `fail 0`.

- [ ] **Step 5: Сохранить:** `git add src/lib/nav-groups.ts src/lib/nav-groups.test.ts package.json`

---

### Task 3: Левая панель: страницы и раскрывающиеся группы

**Files:**
- Modify: `src/components/shell/sidebar.tsx` (отрисовка разделов внутри `nav.sb-page.nav`)
- Modify: `src/styles/timely/ui.css` (рядом с `.nav-item`)

**Interfaces:**
- Consumes: `getDashboardSections`, `matchNavigation` (задача 1); `openGroupsFor`, `toggleGroup`, `groupSignal`, `readOpenGroups`, `writeOpenGroups` (задача 2).
- Produces: строки групп с классом `nav-group-btn`, атрибутами `aria-expanded` и `aria-controls="nav-sub-<key>"`; их пункты внутри `div.nav-sub#nav-sub-<key>`.

- [ ] **Step 1: Отрисовка.**
  - Страницы — существующий `NavItem`. Точка «Идёт занятие» остаётся у «Сейчас», `chatClick` — у Тьютора.
  - Перед первой группой разделитель `div.nav-sep`.
  - Группа — `button.nav-item.nav-group-btn`: иконка раздела, название, сигнал (`nav-count` / `live`) только пока свёрнута, справа `Icon name="chev-r"` с классом `nav-chev`.
  - Пункты группы — `NavItem` в `div.nav-sub`. Сигналы у пунктов — как сейчас.
  - Открытые группы: `useState` из `openGroupsFor(readOpenGroups(), matchNavigation(path).section, GROUP_KEYS)`, где `GROUP_KEYS` — ключи разделов с `kind: "group"`. Читается после монтирования, чтобы не разойтись с сервером. При переходе на страницу свёрнутой группы группа добавляется. Каждое нажатие пишет `writeOpenGroups`.
  - В свёрнутой панели (`collapsed`) нажатие на группу разворачивает панель (`toggleCollapsed`) и открывает группу.

- [ ] **Step 2: Стили в `ui.css`.**
  - `.nav-sep` — 1 px `var(--t-line)`, отступы 6 px 8 px.
  - `.nav-chev` — 14 px, `var(--t-muted)`; при `[aria-expanded="true"]` поворот на 90°, 180 мс.
  - `.nav-sub` — отступ слева 20 px, `border-left: 1px solid var(--t-line)`, `padding-left: 6px`. Раскрытие через `grid-template-rows: 0fr → 1fr`, 220 мс, ease-out; при `prefers-reduced-motion` без перехода.
  - В `.nav-collapsed` спрятать `.nav-chev` и `.nav-sub`.

- [ ] **Step 3: Проверить на стенде** (`.claude/launch.json` → `mock-api` и стенд с `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`), ширина 1440 и 735 px, обе темы:
  - 7 строк при свёрнутых группах;
  - нажатие раскрывает и сворачивает, после перезагрузки состояние то же;
  - прямой заход на `/dashboard/leaderboard` с пустым `localStorage` — «Соревнования» раскрыты, «Рейтинг» подсвечен;
  - в свёрнутой узкой панели нажатие на иконку группы разворачивает панель;
  - Tab и Enter работают.

- [ ] **Step 4: Сохранить:** `git add src/components/shell/sidebar.tsx src/styles/timely/ui.css`

---

### Task 4: Телефон: панель выезжает слева

**Files:**
- Modify: `src/contexts/dashboard-shell.tsx` (открытость меню)
- Create: `src/components/shell/menu-button.tsx`
- Create: `src/components/shell/drawer-swipe.ts`
- Test: `src/components/shell/drawer-swipe.test.ts` (добавить в `test:now`)
- Modify: `src/components/shell/icons.tsx` (иконка `menu`), `src/components/shell/sidebar.tsx`, `src/app/dashboard/layout.tsx`, `src/styles/timely/ui.css`

**Interfaces:**
- Produces:
  ```ts
  // dashboard-shell.tsx: к значению контекста добавляется
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  // menu-button.tsx
  export function MenuButton(): JSX.Element; // button.menu-fab.glass, aria-controls="app-nav"
  // drawer-swipe.ts
  export interface SwipeGesture { x0: number; y0: number; x1: number; y1: number; ms: number }
  export function isOpenSwipe(g: SwipeGesture): boolean;  // x0 >= 20, dx >= 70, |dy| <= dx/2, ms <= 600
  export function isCloseSwipe(g: SwipeGesture): boolean; // -dx >= 60, |dy| <= -dx/2, ms <= 600
  export function startsInHorizontalScroll(target: Element | null): boolean; // предок с overflow-x auto/scroll и scrollWidth > clientWidth
  export function useDrawerSwipe(open: boolean, setOpen: (open: boolean) => void): void; // только при (max-width: 640px)
  ```

- [ ] **Step 1: Тесты жеста:**
  ```ts
  test("открывает свайп вправо, начатый не у самого края", () => {
    assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 140, y1: 310, ms: 250 }), true);
    assert.equal(isOpenSwipe({ x0: 8, y0: 300, x1: 140, y1: 310, ms: 250 }), false);  // системное «назад»
    assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 90, y1: 300, ms: 250 }), false);  // коротко
    assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 140, y1: 420, ms: 250 }), false); // это прокрутка
    assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 140, y1: 300, ms: 900 }), false); // медленно, это не жест
  });
  test("закрывает свайп влево", () => {
    assert.equal(isCloseSwipe({ x0: 260, y0: 300, x1: 180, y1: 305, ms: 200 }), true);
    assert.equal(isCloseSwipe({ x0: 260, y0: 300, x1: 240, y1: 305, ms: 200 }), false);
  });
  ```

- [ ] **Step 2: Запустить, убедиться, что падают:** `npm run -s test:now`.

- [ ] **Step 3: Код.**
  - Контекст: `drawerOpen` и `setDrawerOpen` в `DashboardShellProvider`.
  - `icons.tsx`: символ `i-menu` — три линии `M4 7h16M4 12h16M4 17h16`, тип `"menu"`.
  - `MenuButton`: `button.menu-fab.glass`, `aria-label="Меню"`, `aria-expanded={drawerOpen}`, открывает меню.
  - `drawer-swipe.ts`: чистые функции выше плюс хук. Хук слушает `touchstart`/`touchend` на `document`, пропускает начало в поле ввода и в горизонтальной прокрутке.
  - `Sidebar`:
    - `id="app-nav"`, `data-drawer={drawerOpen ? "open" : "closed"}`;
    - на телефоне при закрытом меню `inert`;
    - Escape закрывает;
    - смена `path` закрывает;
    - при открытии фокус на первый пункт.
    - Флаг `isPhone` из `matchMedia("(max-width: 640px)")`: на телефоне `collapsed` считается `false` и для `showChats`, и для разметки.
  - `layout.tsx`:
    - рядом с `<Sidebar />` добавить `<MenuButton />` и `div.nav-scrim` с `onClick` закрыть и `aria-hidden`;
    - вызвать `useDrawerSwipe` (через маленький клиентский компонент, если layout серверный);
    - `<TabBar />` пока остаётся, его убирает задача 6.

- [ ] **Step 4: Стили (`ui.css`, внутри `@media (max-width: 640px)` вместо `.sidebar { display: none; }`).**
  - `.sidebar`:
    - `position: fixed; top: 0; bottom: 0; left: 0; width: min(80vw, 300px); border-radius: 0 18px 18px 0`;
    - отступы с учётом safe-area;
    - `transform: translateX(-104%)`, переход 260 мс `cubic-bezier(0.23, 1, 0.32, 1)`; `[data-drawer="open"]` → `none`;
    - `z-index` выше `.quick`.
  - `.nav-collapsed .sidebar` на телефоне: ширина и подписи как обычно. `--sb-w` и правила `.nav-collapsed …` переопределить в этом медиазапросе.
  - `.nav-scrim`: `position: fixed; inset: 0; background: rgba(0, 0, 0, 0.42)`, прозрачность 0 и `pointer-events: none`, пока закрыто. Показывается через `html.drawer-open` (класс ставит `Sidebar`), там же `overflow: hidden` у `html`.
  - `.menu-fab`: `--r: 50%`, 40×40, `position: fixed; top: calc(10px + env(safe-area-inset-top)); left: calc(12px + env(safe-area-inset-left))`, иконка 18 px; круглая (`corner-shape: round`). Вне телефона `display: none`.
  - `.main .content` на телефоне: `padding-top: calc(60px + env(safe-area-inset-top))`, чтобы заголовки не уходили под кнопку. В чате (`:root[data-view="chat"]`) не нужно: место держит строка чата.
  - Мелочи по `DESIGN.md`: `prefers-reduced-motion` без перехода.

- [ ] **Step 5: Запустить:** `npm run -s test:now` → `fail 0`; `npx tsc --noEmit` без новых ошибок.

- [ ] **Step 6: Проверить на стенде** (375 × 812, обе темы):
  - кнопка открывает, затемнение закрывает, Escape закрывает, переход закрывает;
  - свайп вправо от x≈40 открывает, по неделе и году в помодоро не открывает, свайп влево закрывает;
  - сначала на компьютере свернуть панель, потом открыть телефон — подписи видны.

- [ ] **Step 7: Сохранить:** `git add src/contexts/dashboard-shell.tsx src/components/shell/{menu-button.tsx,drawer-swipe.ts,drawer-swipe.test.ts,icons.tsx,sidebar.tsx} src/app/dashboard/layout.tsx src/styles/timely/ui.css package.json`

---

### Task 5: Телефон: тьютор через ту же панель

**Files:**
- Modify: `src/components/chat/chat-page.tsx` (убрать `.chats-fab`, `chatsSheet`, `dialog.sheet-chats` и их `ref`; список остаётся порталом в `chatsSlot`)
- Modify: `src/styles/timely/pages.css` (`.chats-fab`), `src/styles/timely/page-chat.css` (отступ строки чата под `.menu-fab`)

**Interfaces:**
- Consumes: `useDashboardShell().setDrawerOpen` (задача 4).

- [ ] **Step 1: Код.**
  - `openChat(id)` и `startNew()` вызывают `setDrawerOpen(false)` вместо `chatsSheet.current?.close()`.
  - Удалить кнопку `.chats-fab`, `dialog.sheet-chats`, `useRef` листа и всё, что с ними связано.
  - В `page-chat.css` левый отступ `.talk > .chat-bar` на телефоне (сейчас `66px`) держит место под `.menu-fab`. Ручка нового чата стоит сразу справа от неё.

- [ ] **Step 2: Стили.** Удалить правила `.chats-fab` в `pages.css` (около 96 и 733–742).

- [ ] **Step 3: Проверить на стенде, 375 px:**
  - в чате кнопка меню открывает список чатов, «‹ Чаты» ведёт в разделы, выбор раздела уводит со страницы;
  - выбор чата и «Новый чат» закрывают панель без остатка затемнения;
  - на компьютере список чатов в панели работает как раньше.

- [ ] **Step 4: Сохранить:** `git add src/components/chat/chat-page.tsx src/styles/timely/pages.css src/styles/timely/page-chat.css`

---

### Task 6: Без нижней панели и вкладок сверху

**Files:**
- Delete: `src/components/shell/tab-bar.tsx` (`TabBar`, `SubNav`, `MORE`, `ME`, `TAB_OF`)
- Modify: `src/app/dashboard/layout.tsx` (убрать `<TabBar />`) и 12 мест с `<SubNav …>`:
  - `src/app/dashboard/arena/solve/page.tsx`, `src/app/dashboard/diary/grades/page.tsx`, `src/app/dashboard/diary/schedule/page.tsx` (2 места), `src/app/dashboard/leaderboard/page.tsx`;
  - `src/components/chat/chat-page.tsx`, `src/components/diary/diary-page.tsx`, `src/components/goals/goals-page.tsx`, `src/components/habits/habits-page.tsx`, `src/components/mind/weak-page.tsx`, `src/components/pomodoro/pomodoro-page.tsx`, `src/components/studyplan/plan-page.tsx`.
- Modify:
  - стили: `src/styles/timely/ui.css`, `pages.css`, `page-focus.css`, `page-diary.css`, `page-demo.css`, `src/app/globals.css`;
  - тур демо: `src/components/demo/demo-tour.tsx`.

- [ ] **Step 1: Удалить компоненты и импорты.** После этого `git grep -n "SubNav\|TabBar\|tab-bar" -- src` ничего не находит.

- [ ] **Step 2: Перепривязать нижние отступы** (без панели на 62 px ниже):
  - `pages.css`:
    - `.quick` `bottom: calc(74px …)` → `calc(12px …)`;
    - `.talk > .composer` `76px` → `12px`;
    - `.chat` `min-height: calc(100vh - 94px)` → `calc(100vh - 32px)`;
    - `.t-toast` `130px` → `68px`;
    - удалить `.subnav`-правила и `html.picking .tabbar`;
  - `ui.css`:
    - удалить `.tabbar`, `.tab`, `.tab-lens` и `.sheet-more`-правила;
    - `.main` `padding-bottom: calc(78px …)` → `calc(64px …)` (место под капсулу);
  - `page-focus.css`: `.fp-alarm` `130px` → `68px`, `188px` → `126px`;
  - `page-diary.css`: `.ds-foot` `130px` → `68px`;
  - `page-demo.css`: `.demo-pill` `80px` → `18px`;
  - `globals.css`: `--tm-tabbar-h: env(safe-area-inset-bottom)`.
  - `demo-tour.tsx`: удалить `dockOffset` и его использование: панели больше нет.

- [ ] **Step 3: Проверить.**
  - `npm run -s test:now`, `test:demo`, `test:pomodoro`, `test:chat` → `fail 0`.
  - `npx tsc --noEmit` без новых ошибок.
  - `npx eslint` по изменённым файлам.
  - На стенде, 375 px: снизу нет панели, сверху нет вкладок раздела; капсула, строка ввода чата, плашка «Пора на перерыв» и нижняя строка дневника стоят у нижнего края, не перекрывают друг друга и слайма; демо-тур проходит до конца.

- [ ] **Step 4: Сохранить:** `git add -A src/` (проверить `git status`, что в списке нет лишнего).

---

### Task 7: Сквозная проверка и сдача

- [ ] **Step 1: Прогнать** все тест-скрипты, которые трогались: `test:now test:routing test:demo test:pomodoro test:chat`, плюс `npx tsc --noEmit` и `npx eslint src/components/shell src/config src/lib/nav-groups.ts`.
- [ ] **Step 2: Пройти на стенде по разделу «Проверка» из спецификации.**
  - Ширины: 1440, 735 и 375 px; обе темы.
  - На телефоне любая страница не дальше трёх нажатий.
  - Путь в тьюторе: кнопка → чаты → «‹ Чаты» → раздел.
  - Демо-тур проходит.
  - Сделать скриншоты для владельца.
- [ ] **Step 3: Обновить `DESIGN.md`, раздел 6 «Компоненты»:** навигация — `.nav-item`, группы `.nav-group-btn` и `.nav-sub`, на телефоне выезжающая панель и `.menu-fab`; нижней панели нет.
- [ ] **Step 4: Показать владельцу** и коммитить только после его «да».
