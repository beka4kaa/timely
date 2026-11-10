// Тексты лендинга на двух языках. Русская страница живёт на «/», английская — на «/en».
// Разметка, иконки и цвета — в landing-page.tsx и компонентах; здесь только слова, в
// том же порядке, в каком они стоят на странице. Английский написан для читателя, а не
// переведён слово в слово: его открывают в том числе эксперты акселераторов.

import type { LandingLocale } from "@/lib/landing-locale";

export type { LandingLocale };

export type PromptChip = { label: string; prompt: string };

export interface HeroPromptCopy {
  examples: string[];
  /** Четыре подсказки под полем: план, тема, задача, контрольная. */
  chips: [PromptChip, PromptChip, PromptChip, PromptChip];
  /** Ещё две, по кнопке «Ещё»: проверить решение, повторить тему. */
  more: [PromptChip, PromptChip];
  moreLabel: string;
  hint: string;
  fieldLabel: string;
  sendLabel: string;
}

export interface ChatDemoCopy {
  today: string[];
  earlier: string[];
  tutor: string;
  course: string;
  todayGroup: string;
  earlierGroup: string;
  subject: string;
  source: string;
  threadLabel: string;
  ask: string;
  lead: string;
  explain: string;
  formulaCaption: string;
  cite: string;
  question: string;
  reply: string;
  answer: string;
}

export type UseCaseId = "tutor" | "review" | "plan";

export interface UseCasesCopy {
  tabsLabel: string;
  cases: Record<UseCaseId, { tab: string; title: string; text: string; meta: string }>;
  /** Две строки на экране телефона. */
  phoneTitle: [string, string];
  phonePrompt: string;
  reviewHead: string;
  reviews: { time: string; task: string }[];
  planHead: string;
  /** Пять строк плана: две сделаны, одна идёт, две впереди. */
  plan: [string, string, string, string, string];
  nowLabel: string;
  nowLeft: string;
}

export type SubjectKey =
  | "algebra"
  | "geometry"
  | "physics"
  | "chemistry"
  | "biology"
  | "geography"
  | "informatics"
  | "astronomy"
  | "russian"
  | "literature"
  | "english"
  | "kazakh"
  | "history"
  | "law"
  | "economics"
  | "science";

export interface FaqItem {
  q: string;
  a: string;
}

export interface TitledText {
  title: string;
  text: string;
}

export interface LandingCopy {
  locale: LandingLocale;
  /** Адрес этой версии страницы. */
  path: "/" | "/en";
  meta: { title: string; description: string; ogLocale: string };
  nav: { label: string; tutor: string; how: string; subjects: string; faq: string; demo: string };
  header: { signIn: string; open: string; openShort: string };
  theme: { toLight: string; toDark: string };
  lang: { label: string; ru: string; en: string };
  hero: { before: string; after: string; line2: string; lead: string };
  prompt: HeroPromptCopy;
  manifesto: string;
  chat: { title: string; sub: string; features: [TitledText, TitledText, TitledText] };
  chatDemo: ChatDemoCopy;
  how: { title: string; sub: string };
  useCases: UseCasesCopy;
  subjects: {
    eyebrow: string;
    title: string;
    sub: string;
    labels: Record<SubjectKey, string>;
    more: string;
    course: TitledText;
    tell: TitledText;
  };
  inside: {
    eyebrow: string;
    title: string;
    step: { stat: string; text: string; foot: string };
    diary: { quote: string; foot: string };
    weak: { quote: string; foot: string; topics: [string, number][] };
    modes: { list: string[]; active: string; title: string; foot: string };
    focus: { ring: string; text: string; foot: string };
    practice: { quote: string; foot: string };
  };
  faq: { eyebrow: string; title: string; sub: string; items: FaqItem[] };
  cta: { title: string; sub: string; open: string; demo: string; register: string };
  footer: {
    note: string;
    /** Ссылки ведут в приложение: путь на app-хосте. */
    columns: { title: string; links: [label: string, path: string][] }[];
  };
  slime: { label: string; ctaLabel: string; sleepGlyph: string };
}

const ru: LandingCopy = {
  locale: "ru",
  path: "/",
  meta: {
    title: "TimelyPlan — AI-друг для учёбы",
    description: "Дневник, план на день и AI-тьютор, который объясняет по твоему учебнику.",
    ogLocale: "ru_RU",
  },
  nav: {
    label: "Разделы страницы",
    tutor: "Тьютор",
    how: "Как это работает",
    subjects: "Предметы",
    faq: "Вопросы",
    demo: "Демо",
  },
  header: { signIn: "Войти", open: "Открыть Timely", openShort: "Открыть" },
  theme: { toLight: "Включить светлую тему", toDark: "Включить тёмную тему" },
  lang: { label: "Язык страницы", ru: "Русский", en: "English" },
  hero: {
    before: "Привет, это",
    after: "Timely",
    line2: "Твой AI-друг для учёбы",
    lead: "Расскажи, что задали, — Timely разложит домашку на понятные шаги, объяснит сложную тему по твоему учебнику и поможет проверить решение.",
  },
  prompt: {
    examples: [
      "Объясни второй закон Ньютона на примере",
      "Составь план подготовки к СОЧ по алгебре",
      "Проверь моё решение задачи про скорость",
      "Что такое валентность? Объясни простыми словами",
    ],
    chips: [
      { label: "План на день", prompt: "Составь план на сегодня. Задали: " },
      { label: "Объяснить тему", prompt: "Объясни простыми словами тему " },
      { label: "Решить задачу", prompt: "Помоги разобраться с задачей: " },
      { label: "К контрольной", prompt: "Помоги подготовиться к контрольной по " },
    ],
    more: [
      { label: "Проверить решение", prompt: "Проверь моё решение: " },
      { label: "Повторить тему", prompt: "Давай повторим тему " },
    ],
    moreLabel: "Ещё",
    hint: "Ответ откроется в Timely",
    fieldLabel: "Вопрос для Timely",
    sendLabel: "Спросить Timely",
  },
  manifesto:
    "Тебе не нужно держать всю учёбу в голове. Timely показывает один следующий шаг и помогает, когда застрял.",
  chat: {
    title: "Обычный чат, после которого тема понятна",
    sub: "Пиши как другу. Timely уточнит, что именно непонятно, объяснит по шагам и проверит, что ты разобрался.",
    features: [
      {
        title: "Понимает с полуслова",
        text: "Пиши как обычно, с опечатками и сокращениями. Переспросит, только если без этого не обойтись.",
      },
      {
        title: "Отвечает по твоему учебнику",
        text: "Загрузи учебник — тьютор объяснит тему по нему и покажет страницу, где об этом написано.",
      },
      {
        title: "Учиться без гонки",
        text: "Короткие занятия, перерывы и фокус-таймер — в твоём темпе, без давления.",
      },
    ],
  },
  chatDemo: {
    today: ["Второй закон Ньютона", "План на неделю", "Квадратные уравнения"],
    earlier: [
      "Подготовка к СОЧ по химии",
      "Эссе по «Капитанской дочке»",
      "Фотосинтез простыми словами",
      "Дроби без паники",
    ],
    tutor: "Тьютор",
    course: "Курс по книге",
    todayGroup: "Сегодня",
    earlierGroup: "Ранее",
    subject: "Физика, 9 класс",
    source: "По учебнику",
    threadLabel: "Пример разговора с тьютором Timely про второй закон Ньютона",
    ask: "Не понимаю второй закон Ньютона",
    lead: "Давай разберёмся на примере.",
    explain:
      "Толкни пустую тележку в магазине — она легко разгоняется. Нагрузи её покупками, и тот же толчок разгонит её заметно медленнее. Ускорение зависит от силы и от массы:",
    formulaCaption: "ускорение = сила / масса",
    cite: "Физика 9, §10, с. 48",
    question:
      "Как думаешь: если массу увеличить вдвое, а силу оставить прежней, что станет с ускорением?",
    reply: "Уменьшится в два раза?",
    answer:
      "Именно! Теперь попробуй сам: тележку массой 20 кг толкают с силой 40 Н. Найди ускорение — если застрянешь, подскажу следующий шаг.",
  },
  how: {
    title: "Как Timely помогает каждый день",
    sub: "От одного вопроса до подготовки к четвертной — вот как Timely встраивается в учёбу.",
  },
  useCases: {
    tabsLabel: "Как помогает Timely",
    cases: {
      tutor: {
        tab: "Тьютор",
        title: "Спроси и разберись",
        text: "Задай вопрос по теме или по задаче. Тьютор объяснит по твоему учебнику, приведёт пример и проверит, понял ли ты.",
        meta: "Ответ со ссылкой на страницу",
      },
      review: {
        tab: "Повторение",
        title: "Помни, что изучил",
        text: "Напиши своими словами, что прошли на уроке. Timely сам заполнит темы и напомнит повторить, когда пора.",
        meta: "Напоминает слайм и уведомления",
      },
      plan: {
        tab: "План",
        title: "Один следующий шаг",
        text: "Программу по учебнику Timely раскладывает по дням и часам. Открываешь — и сразу видно, что делать сейчас.",
        meta: "Разложено по дням и часам",
      },
    },
    phoneTitle: ["Твой AI-друг", "для учёбы"],
    phonePrompt: "Помоги подготовиться к контрольной по алгебре в пятницу",
    reviewHead: "Пора повторить",
    reviews: [
      { time: "сегодня", task: "Квадратные неравенства" },
      { time: "завтра", task: "Закон Ома" },
      { time: "чт", task: "Метод интервалов" },
      { time: "сб", task: "Законы Ньютона" },
    ],
    planHead: "Сегодня",
    plan: [
      "Алгебра: номера 214–216",
      "Физика: разобрать условие задачи",
      "Решить две задачи на второй закон Ньютона",
      "Перерыв",
      "Повторить квадратные уравнения",
    ],
    nowLabel: "Идёт сейчас, осталось 12 минут",
    nowLeft: "осталось 12 мин",
  },
  subjects: {
    eyebrow: "Предметы",
    title: "Все школьные предметы в одном месте",
    sub: "Алгебра, физика, языки, история — тьютор разбирает темы школьной программы, а с загруженным учебником отвечает по нему.",
    labels: {
      algebra: "Алгебра",
      geometry: "Геометрия",
      physics: "Физика",
      chemistry: "Химия",
      biology: "Биология",
      geography: "География",
      informatics: "Информатика",
      astronomy: "Астрономия",
      russian: "Русский язык",
      literature: "Литература",
      english: "Английский",
      kazakh: "Казахский язык",
      history: "История",
      law: "Право",
      economics: "Экономика",
      science: "Естествознание",
    },
    more: "Загрузить свой учебник",
    course: {
      title: "Курс по твоему учебнику",
      text: "Загрузи PDF — Timely разберёт его на модули, темы и страницы и составит программу.",
    },
    tell: {
      title: "Напиши, что изучил",
      text: "Своими словами, как другу. Timely сам заполнит темы и напомнит повторить, когда пора.",
    },
  },
  inside: {
    eyebrow: "Внутри Timely",
    title: "Всё для учёбы — в одном месте",
    step: {
      stat: "1 шаг",
      text: "вместо списка из тридцати дел. Открываешь Timely — и видно, что делать сейчас.",
      foot: "План",
    },
    diary: {
      quote: "Неделя, уроки и оценки — рядом с планом, а не в отдельном приложении.",
      foot: "Дневник",
    },
    weak: {
      quote: "Темы, где были ошибки, не теряются — Timely напомнит к ним вернуться.",
      foot: "Слабые темы",
      topics: [
        ["Дроби", 38],
        ["Валентность", 56],
        ["Past Simple", 72],
      ],
    },
    modes: {
      list: ["Обычный", "Планирование", "Наводящая помощь", "Брейншторм", "Проверь меня"],
      active: "Наводящая помощь",
      title:
        "Тьютор не решает за тебя, пока ты сам не попросишь. Выбери, что нужно сейчас: подсказки, идеи или проверка.",
      foot: "Режимы тьютора",
    },
    focus: {
      ring: "Фокус",
      text: "Фокус-сессии и время учёбы — таймер всегда под рукой.",
      foot: "Помодоро",
    },
    practice: {
      quote: "Практика по пройденной теме, чтобы закрепить, а не просто прочитать.",
      foot: "Самостоятельная",
    },
  },
  faq: {
    eyebrow: "Вопросы",
    title: "Частые вопросы",
    sub: "Коротко о том, как устроен Timely и с чего начать.",
    items: [
      {
        q: "Что такое Timely?",
        a: "Учебное пространство для школьников: дневник, план и AI-тьютор в одном месте. Timely показывает, что делать сейчас, и помогает, когда застрял.",
      },
      {
        q: "Тьютор решит задачу за меня?",
        a: "Нет, и это специально. Он идёт от условия к решению вместе с тобой: подсказки выдаются по одной, а следующий шаг каждый раз остаётся за тобой.",
      },
      {
        q: "Можно заниматься по своему учебнику?",
        a: "Да. Загрузи учебник в разделе «Курс по книге»: Timely разберёт его на модули, темы и страницы, а тьютор будет отвечать со ссылкой на страницу.",
      },
      {
        q: "Какие предметы поддерживаются?",
        a: "Любые школьные — от алгебры и физики до истории и языков. Если у предмета есть загруженный учебник, ответы опираются на него, если нет — тьютор объясняет своими словами.",
      },
      {
        q: "Нужен ли отдельный дневник или таймер?",
        a: "Нет. Расписание, оценки, задачи, помодоро и привычки уже внутри Timely, рядом с планом.",
      },
      {
        q: "Как начать?",
        a: "Нажми «Открыть Timely» и войди через Google или по почте. Начни с вопроса по сегодняшней домашке.",
      },
    ],
  },
  cta: {
    title: "Начни с одного вопроса",
    sub: "Расскажи, что задали на завтра, и посмотри, как Timely разложит это на шаги.",
    open: "Открыть Timely",
    demo: "Посмотреть демо",
    register: "Создать аккаунт",
  },
  footer: {
    note: "Учебное пространство для школьников.",
    columns: [
      {
        title: "Учёба",
        links: [
          ["Тьютор", "/chat"],
          ["Курс по книге", "/curriculum"],
          ["План", "/plan"],
        ],
      },
      {
        title: "Каждый день",
        links: [
          ["Дневник", "/diary"],
          ["Помодоро", "/pomodoro"],
          ["Привычки", "/habits"],
          ["Слабые темы", "/weaknesses"],
        ],
      },
      {
        title: "Аккаунт",
        links: [
          ["Войти", "/auth/signin"],
          ["Создать аккаунт", "/auth/register"],
        ],
      },
    ],
  },
  slime: {
    label: "Слайм Timely",
    ctaLabel: "Слайм Timely. Нажми — подпрыгнет",
    sleepGlyph: "з",
  },
};

const en: LandingCopy = {
  locale: "en",
  path: "/en",
  meta: {
    title: "TimelyPlan — your AI study buddy",
    description:
      "A planner, school diary and AI tutor in one place. Timely explains topics from your own textbook and shows you the next step — without doing your homework for you.",
    ogLocale: "en_US",
  },
  nav: {
    label: "Page sections",
    tutor: "Tutor",
    how: "How it works",
    subjects: "Subjects",
    faq: "FAQ",
    demo: "Demo",
  },
  header: { signIn: "Sign in", open: "Open Timely", openShort: "Open" },
  theme: { toLight: "Switch to light theme", toDark: "Switch to dark theme" },
  lang: { label: "Page language", ru: "Русский", en: "English" },
  hero: {
    before: "Hi, this is",
    after: "Timely",
    line2: "Your AI study buddy",
    lead: "Tell Timely what's due — it breaks your homework into clear steps, explains tough topics using your own textbook, and helps you check your answers.",
  },
  prompt: {
    examples: [
      "Explain Newton's second law with an example",
      "Make a study plan for Friday's algebra test",
      "Check my solution to this speed problem",
      "What is valence? Explain it simply",
    ],
    chips: [
      { label: "Plan my day", prompt: "Make a plan for today. My homework: " },
      { label: "Explain a topic", prompt: "Explain this topic in simple words: " },
      { label: "Solve a problem", prompt: "Help me work through this problem: " },
      { label: "Test prep", prompt: "Help me get ready for my test in " },
    ],
    more: [
      { label: "Check my answer", prompt: "Check my solution: " },
      { label: "Review a topic", prompt: "Let's review " },
    ],
    moreLabel: "More",
    hint: "The answer opens in Timely",
    fieldLabel: "Your question for Timely",
    sendLabel: "Ask Timely",
  },
  manifesto:
    "You don't have to keep all of school in your head. Timely shows you one next step and helps when you get stuck.",
  chat: {
    title: "A simple chat that makes the topic click",
    sub: "Write the way you'd text a friend. Timely asks what exactly is unclear, explains it step by step and checks that you really got it.",
    features: [
      {
        title: "Gets what you mean",
        text: "Type the way you normally do, typos and shortcuts included. It only asks a follow-up when it truly needs one.",
      },
      {
        title: "Answers from your textbook",
        text: "Upload your textbook and the tutor explains the topic from it — and shows the page where it's covered.",
      },
      {
        title: "Learning without the rush",
        text: "Short sessions, breaks and a focus timer — at your own pace, no pressure.",
      },
    ],
  },
  chatDemo: {
    today: ["Newton's second law", "Plan for the week", "Quadratic equations"],
    earlier: [
      "Chemistry test prep",
      "Essay on The Captain's Daughter",
      "Photosynthesis made simple",
      "Fractions without panic",
    ],
    tutor: "Tutor",
    course: "Textbook course",
    todayGroup: "Today",
    earlierGroup: "Earlier",
    subject: "Physics, grade 9",
    source: "From the textbook",
    threadLabel: "A sample conversation with the Timely tutor about Newton's second law",
    ask: "I don't get Newton's second law",
    lead: "Let's work through an example.",
    explain:
      "Push an empty shopping cart and it speeds up easily. Fill it with groceries, and the same push gets it going much more slowly. Acceleration depends on both the force and the mass:",
    formulaCaption: "acceleration = force / mass",
    cite: "Physics 9, §10, p. 48",
    question:
      "What do you think: if you double the mass and keep the force the same, what happens to the acceleration?",
    reply: "It gets cut in half?",
    answer:
      "Exactly! Now try one yourself: a 20 kg cart is pushed with a force of 40 N. Find its acceleration — if you get stuck, I'll hint at the next step.",
  },
  how: {
    title: "How Timely helps every day",
    sub: "From a single question to end-of-term exam prep — here's how Timely fits into school life.",
  },
  useCases: {
    tabsLabel: "How Timely helps",
    cases: {
      tutor: {
        tab: "Tutor",
        title: "Ask and figure it out",
        text: "Ask about a topic or a problem. The tutor explains it from your textbook, gives an example and checks that you understood.",
        meta: "Answers point to the page",
      },
      review: {
        tab: "Review",
        title: "Remember what you learned",
        text: "Write down what you covered in class, in your own words. Timely fills in the topics and reminds you to review them when it's time.",
        meta: "The slime and notifications remind you",
      },
      plan: {
        tab: "Plan",
        title: "One next step",
        text: "Timely spreads your textbook course across days and hours. Open it and you instantly see what to do now.",
        meta: "Laid out by day and hour",
      },
    },
    phoneTitle: ["Your AI", "study buddy"],
    phonePrompt: "Help me get ready for Friday's algebra test",
    reviewHead: "Time to review",
    reviews: [
      { time: "today", task: "Quadratic inequalities" },
      { time: "tomorrow", task: "Ohm's law" },
      { time: "Thu", task: "The interval method" },
      { time: "Sat", task: "Newton's laws" },
    ],
    planHead: "Today",
    plan: [
      "Algebra: exercises 214–216",
      "Physics: unpack the problem statement",
      "Solve two problems on Newton's second law",
      "Break",
      "Review quadratic equations",
    ],
    nowLabel: "In progress, 12 minutes left",
    nowLeft: "12 min left",
  },
  subjects: {
    eyebrow: "Subjects",
    title: "Every school subject in one place",
    sub: "Algebra, physics, languages, history — the tutor covers the school curriculum, and once you upload a textbook it answers from that book.",
    labels: {
      algebra: "Algebra",
      geometry: "Geometry",
      physics: "Physics",
      chemistry: "Chemistry",
      biology: "Biology",
      geography: "Geography",
      informatics: "Computer science",
      astronomy: "Astronomy",
      russian: "Russian",
      literature: "Literature",
      english: "English",
      kazakh: "Kazakh",
      history: "History",
      law: "Law",
      economics: "Economics",
      science: "Natural science",
    },
    more: "Upload your textbook",
    course: {
      title: "A course built from your textbook",
      text: "Upload a PDF — Timely splits it into modules, topics and pages and turns it into a study program.",
    },
    tell: {
      title: "Tell it what you studied",
      text: "In your own words, like texting a friend. Timely fills in the topics and reminds you to review when it's time.",
    },
  },
  inside: {
    eyebrow: "Inside Timely",
    title: "Everything for school, in one place",
    step: {
      stat: "1 step",
      text: "instead of a thirty-item to-do list. Open Timely and you can see what to do right now.",
      foot: "Plan",
    },
    diary: {
      quote: "Your week, lessons and grades sit right next to the plan — not in another app.",
      foot: "School diary",
    },
    weak: {
      quote: "Topics you made mistakes in don't get lost — Timely reminds you to come back to them.",
      foot: "Weak topics",
      topics: [
        ["Fractions", 38],
        ["Valence", 56],
        ["Past Simple", 72],
      ],
    },
    modes: {
      list: ["Standard", "Planning", "Guided help", "Brainstorm", "Quiz me"],
      active: "Guided help",
      title:
        "The tutor won't solve it for you unless you ask. Pick what you need right now: hints, ideas or a check.",
      foot: "Tutor modes",
    },
    focus: {
      ring: "Focus",
      text: "Focus sessions and study time — the timer is always at hand.",
      foot: "Pomodoro",
    },
    practice: {
      quote: "Practice on the topic you just covered, so it sticks instead of just being read.",
      foot: "Practice",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "Frequently asked questions",
    sub: "A quick look at how Timely works and where to start.",
    items: [
      {
        q: "What is Timely?",
        a: "A study space for school students: a planner, a school diary and an AI tutor in one place. Timely shows what to do right now and helps when you're stuck.",
      },
      {
        q: "Will the tutor solve problems for me?",
        a: "No, and that's on purpose. It goes from the problem to the solution together with you: hints come one at a time, and the next step is always yours to take.",
      },
      {
        q: "Can I study from my own textbook?",
        a: "Yes. Upload it under “Textbook course”: Timely splits it into modules, topics and pages, and the tutor answers with a link to the page.",
      },
      {
        q: "Which subjects does it cover?",
        a: "Any school subject, from algebra and physics to history and languages. If a subject has an uploaded textbook, answers are based on it; if not, the tutor explains in its own words.",
      },
      {
        q: "Do I need a separate planner or timer?",
        a: "No. Your timetable, grades, tasks, Pomodoro timer and habits are already inside Timely, right next to your plan.",
      },
      {
        q: "Is the app in English?",
        a: "Not yet. The app itself is in Russian: Timely is built first for students in Kazakhstan and other Russian-speaking countries, and Kazakh is planned next.",
      },
      {
        q: "How do I get started?",
        a: "Click “Open Timely” and sign in with Google or email. Start with a question about today's homework.",
      },
    ],
  },
  cta: {
    title: "Start with one question",
    sub: "Tell Timely what's due tomorrow and watch it break the work into steps.",
    open: "Open Timely",
    demo: "Try the demo",
    register: "Create an account",
  },
  footer: {
    note: "A study space for school students.",
    columns: [
      {
        title: "Study",
        links: [
          ["Tutor", "/chat"],
          ["Textbook course", "/curriculum"],
          ["Plan", "/plan"],
        ],
      },
      {
        title: "Every day",
        links: [
          ["School diary", "/diary"],
          ["Pomodoro", "/pomodoro"],
          ["Habits", "/habits"],
          ["Weak topics", "/weaknesses"],
        ],
      },
      {
        title: "Account",
        links: [
          ["Sign in", "/auth/signin"],
          ["Create an account", "/auth/register"],
        ],
      },
    ],
  },
  slime: {
    label: "Timely's slime",
    ctaLabel: "Timely's slime. Tap it to make it jump",
    sleepGlyph: "z",
  },
};

export const LANDING_COPY: Record<LandingLocale, LandingCopy> = { ru, en };
