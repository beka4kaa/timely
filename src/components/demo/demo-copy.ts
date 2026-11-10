import type { DemoLang } from "@/lib/demo-mode"

type Text = Record<DemoLang, string>

/**
 * Остановка тура. `target` — CSS-селектор цели на странице (берётся первая видимая);
 * без него карточка встаёт по центру. Селекторы опираются на классы самих страниц:
 * если вёрстка поменяется и цель пропадёт, карточка просто встанет по центру.
 * `route` — раздел, куда тур переводит перед остановкой.
 */
export interface TourStop {
  id: string
  route: string
  target: string | null
  /** Открыть в чате разговор, в заголовке которого есть это слово (без регистра). */
  chatMatch?: string
  title: Text
  body: Text
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: "welcome",
    route: "/dashboard",
    target: null,
    title: {
      en: "Hi, I'm the Timely slime",
      ru: "Привет, я слизень Timely",
    },
    body: {
      en: "Timely is a study OS for school students. It knows the timetable, homework and goals, shows one next step, and its tutor helps without solving for you. You're in the account of Aliya, a made-up 10th grader in Almaty. Seven stops, about a minute.",
      ru: "Timely — учебная система для школьника. Он знает расписание, домашку и цели, показывает один следующий шаг, а тьютор помогает, но не решает за ученика. Ты в аккаунте Алии — выдуманной ученицы 10 класса из Алматы. Семь остановок, около минуты.",
    },
  },
  {
    id: "now",
    route: "/dashboard",
    target: "li.step.is-now, .now",
    title: { en: "One next step", ru: "Один следующий шаг" },
    body: {
      en: "Not a to-do list: the one thing to do right now, with a timer and a clear finish line. School lessons come from the diary, and study fills the time after school.",
      ru: "Не список дел, а одно дело на сейчас: с таймером и понятным «готово». Уроки берутся из дневника, а учёба встаёт после школы.",
    },
  },
  {
    id: "week",
    route: "/dashboard/plan",
    target: ".cal-wrap, .cal",
    title: { en: "The whole week in one place", ru: "Вся неделя в одном месте" },
    body: {
      en: "Lessons, homework and study blocks share one calendar. When plans change, the AI proposes a new week and shows exactly what moves before anything changes.",
      ru: "Уроки, домашка и учёба в одном календаре. Если планы меняются, ИИ предлагает новую неделю и заранее показывает, что сдвинется.",
    },
  },
  {
    id: "tutor",
    route: "/dashboard/chat",
    target: ".log:not(.log-new), .log",
    chatMatch: "тригонометр",
    title: { en: "A tutor that doesn't solve for you", ru: "Тьютор, который не решает за тебя" },
    body: {
      en: "Aliya got stuck on a trig equation. The tutor gave one hint at a time, checked each step and ended with a similar problem. Ask it something yourself: the answers are live.",
      ru: "Алия застряла на тригонометрическом уравнении. Тьютор подсказывал по шагу, проверял каждый шаг и в конце дал похожую задачу. Спроси что-нибудь сам — ответит по-настоящему.",
    },
  },
  {
    id: "weak",
    route: "/dashboard/weaknesses",
    target: ".rv-deck, .rv",
    title: { en: "Topics return before they fade", ru: "Темы возвращаются, пока не забылись" },
    body: {
      en: "Spaced repetition: a weak topic comes back right when it starts to fade, as a short recall question rather than a re-read.",
      ru: "Интервальное повторение: слабая тема возвращается, когда начинает забываться, — коротким вопросом, а не перечитыванием.",
    },
  },
  {
    id: "goals",
    route: "/dashboard/goals",
    target: ".plq-hero-wrap, .gl-grid",
    title: { en: "Every day has a reason", ru: "У каждого дня есть зачем" },
    body: {
      en: "University entrance exam, a math olympiad, English B2. Study blocks are tied to goals, so the week adds up to something.",
      ru: "ЕНТ, олимпиада, английский B2. Блоки учёбы привязаны к целям, поэтому неделя складывается во что-то.",
    },
  },
  {
    id: "contests",
    route: "/dashboard/arena/solve",
    target: ".plq-hero-wrap, .ct-note",
    title: { en: "Contests and an honest rating", ru: "Контесты и честный рейтинг" },
    body: {
      en: "Subject contests and a rating that measures skill, not time spent in the app.",
      ru: "Контесты по предметам и рейтинг, который меряет навык, а не время в приложении.",
    },
  },
  {
    id: "ask",
    route: "/dashboard",
    target: ".q-pill",
    title: { en: "Ask from any page", ru: "Спроси с любой страницы" },
    body: {
      en: "Quick ask sits at the bottom of every page. Write “I'm free at seven today” or “add chemistry homework for tomorrow”, and it prepares the change for you to apply or undo.",
      ru: "Внизу каждой страницы есть быстрый вопрос. Напиши «сегодня освобожусь в семь» или «добавь домашку по химии на завтра» — он подготовит изменение, а ты применишь его или вернёшь как было.",
    },
  },
]

export const DEMO_UI = {
  start: { en: "Start the tour", ru: "Начать тур" },
  skip: { en: "Look around myself", ru: "Посмотрю сам" },
  next: { en: "Next", ru: "Дальше" },
  back: { en: "Back", ru: "Назад" },
  finish: { en: "Explore on my own", ru: "Дальше сам" },
  close: { en: "Close the tour", ru: "Закрыть тур" },
  of: { en: "of", ru: "из" },
  demo: { en: "Demo account", ru: "Демо-аккаунт" },
  demoNote: { en: "Made-up data", ru: "Данные выдуманные" },
  tour: { en: "Tour", ru: "Тур" },
  lang: { en: "Русский", ru: "English" },
  entryTitle: { en: "Setting up the demo", ru: "Готовим демо" },
  entrySubtitle: {
    en: "You'll be in the account of Aliya, a 10th grader: a week of lessons, homework, goals and tutor chats. No sign-up.",
    ru: "Ты окажешься в аккаунте Алии из 10 класса: неделя уроков, домашка, цели и чаты с тьютором. Без регистрации.",
  },
  entrySigningIn: { en: "Opening a guest account…", ru: "Заводим гостевой аккаунт…" },
  entrySeeding: { en: "Filling in the week…", ru: "Заполняем неделю…" },
  entryOpening: { en: "Opening Timely…", ru: "Открываем Timely…" },
  entryRetry: { en: "Try again", ru: "Попробовать ещё раз" },
  entryTooMany: {
    en: "Too many demo accounts from this network. Try again in an hour.",
    ru: "С этой сети уже завели много демо. Попробуй через час.",
  },
  entryFailed: {
    en: "The demo server didn't respond. Try again in a minute.",
    ru: "Демо-сервер не ответил. Попробуй через минуту.",
  },
} satisfies Record<string, Text>
