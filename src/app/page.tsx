import { Fragment, type CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Atom,
  BookOpen,
  CalendarDays,
  CodeXml,
  Dna,
  Dumbbell,
  Earth,
  FlaskConical,
  Landmark,
  Languages,
  Leaf,
  MessageCircle,
  NotebookPen,
  PenLine,
  PenTool,
  Scale,
  Sigma,
  Target,
  Telescope,
  Timer,
  TrendingUp,
  Triangle,
  type LucideIcon,
} from "lucide-react";
import { appLink } from "@/components/landing/app-url";
import { BoardSketch } from "@/components/landing/board-sketch";
import { ChatDemo } from "@/components/landing/chat-demo";
import { Faq } from "@/components/landing/faq";
import { HeroPrompt } from "@/components/landing/hero-prompt";
import { LogoMark } from "@/components/landing/logo-mark";
import { Reveal } from "@/components/landing/reveal";
import { ScrollFx } from "@/components/landing/scroll-fx";
import { Slime } from "@/components/landing/slime";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { ThemeSwitch } from "@/components/landing/theme-switch";
import { UseCases } from "@/components/landing/use-cases";
import styles from "@/components/landing/landing.module.css";

export const metadata: Metadata = {
  title: "TimelyPlan — AI-друг для учёбы",
  description:
    "Дневник, план на день, научная доска и AI-тьютор, который объясняет по твоему учебнику.",
};

// Своя тёмная тема есть — без этого Chrome с «авто-тёмным режимом»
// инвертирует светлую версию.
export const viewport: Viewport = {
  colorScheme: "light dark",
};

type Tint = "lilac" | "pink" | "sky" | "mint";

const TINT: Record<Tint, string> = {
  lilac: styles.tintLilac,
  pink: styles.tintPink,
  sky: styles.tintSky,
  mint: styles.tintMint,
};

const FEATURES: { icon: LucideIcon; tint: Tint; title: string; text: string }[] = [
  {
    icon: MessageCircle,
    tint: "pink",
    title: "Понимает с полуслова",
    text: "Пиши как обычно, с опечатками и сокращениями. Переспросит, только если без этого не обойтись.",
  },
  {
    icon: BookOpen,
    tint: "lilac",
    title: "Отвечает по твоему учебнику",
    text: "Загрузи учебник — тьютор объяснит тему по нему и покажет страницу, где об этом написано.",
  },
  {
    icon: Leaf,
    tint: "sky",
    title: "Учиться без гонки",
    text: "Короткие занятия, перерывы и фокус-таймер — в твоём темпе, без давления.",
  },
];

type Subject = { label: string; tint: Tint; icon?: LucideIcon; glyph?: string };

const SUBJECTS: Subject[][] = [
  [
    { label: "Алгебра", icon: Sigma, tint: "lilac" },
    { label: "Геометрия", icon: Triangle, tint: "sky" },
    { label: "Физика", icon: Atom, tint: "pink" },
    { label: "Химия", icon: FlaskConical, tint: "mint" },
    { label: "Биология", icon: Dna, tint: "pink" },
    { label: "География", icon: Earth, tint: "sky" },
    { label: "Информатика", icon: CodeXml, tint: "lilac" },
    { label: "Астрономия", icon: Telescope, tint: "sky" },
  ],
  [
    { label: "Русский язык", glyph: "Аа", tint: "pink" },
    { label: "Литература", icon: BookOpen, tint: "lilac" },
    { label: "Английский", icon: Languages, tint: "sky" },
    { label: "Казахский язык", glyph: "Қ", tint: "mint" },
    { label: "История", icon: Landmark, tint: "pink" },
    { label: "Право", icon: Scale, tint: "lilac" },
    { label: "Экономика", icon: TrendingUp, tint: "mint" },
    { label: "Естествознание", icon: Leaf, tint: "sky" },
  ],
];

const WEAK_TOPICS: [string, number][] = [
  ["Дроби", 38],
  ["Валентность", 56],
  ["Past Simple", 72],
];

const FOOTER = [
  {
    title: "Учёба",
    links: [
      ["Тьютор", "/chat"],
      ["Научная доска", "/whiteboard"],
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
];

const MANIFESTO =
  "Тебе не нужно держать всю учёбу в голове. Timely показывает один следующий шаг и помогает, когда застрял.";

function Words({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(" ").map((word, index) => (
        <Fragment key={index}>
          <span className={styles.word} style={{ "--i": from + index } as CSSProperties}>
            {word}
          </span>{" "}
        </Fragment>
      ))}
    </>
  );
}

function SubjectRow({ items, reverse }: { items: Subject[]; reverse?: boolean }) {
  // Список повторён дважды: лента едет на половину ширины и незаметно
  // начинается заново. Копия скрыта от скринридеров.
  const list = (copy: boolean) => (
    <ul className={styles.tiles} aria-hidden={copy || undefined}>
      {items.map(({ label, icon: Icon, glyph, tint }) => (
        <li key={label} className={`${styles.tile} ${TINT[tint]}`}>
          <span className={styles.tileIcon}>
            {Icon ? <Icon size={22} strokeWidth={1.8} /> : <span className={styles.glyph}>{glyph}</span>}
          </span>
          <span className={styles.tileLabel}>{label}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={reverse ? styles.shiftReverse : styles.shift}>
      <div className={`${styles.track} ${reverse ? styles.trackReverse : ""}`}>
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className={styles.page}>
      <SmoothScroll />
      <header className={styles.header}>
        <span className={styles.progress} aria-hidden="true" />
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand}>
            <LogoMark size={30} />
            Timely
          </Link>
          <nav className={styles.nav} aria-label="Разделы страницы">
            <a href="#chat" className={styles.navLink}>
              Тьютор
            </a>
            <a href="#how" className={styles.navLink}>
              Как это работает
            </a>
            <a href="#subjects" className={styles.navLink}>
              Предметы
            </a>
            <a href="#faq" className={styles.navLink}>
              Вопросы
            </a>
          </nav>
          <div className={styles.headerActions}>
            <ThemeSwitch />
            <Link href={appLink("/auth/signin")} className={styles.signIn}>
              Войти
            </Link>
            <Link href={appLink()} className={styles.darkButton}>
              Открыть Timely
            </Link>
          </div>
        </div>
      </header>

      <main>
        <ScrollFx as="section" mode="exit" className={styles.hero}>
          <div className={styles.clouds} aria-hidden="true">
            <span className={`${styles.cloud} ${styles.cloud1}`} />
            <span className={`${styles.cloud} ${styles.cloud2}`} />
            <span className={`${styles.cloud} ${styles.cloud3}`} />
            <span className={`${styles.cloud} ${styles.cloud4}`} />
          </div>

          <div className={`${styles.container} ${styles.heroInner}`}>
            <h1 className={styles.title}>
              <span className={styles.titleLine}>
                <Words text="Привет, это" />
                <span className={styles.inlineSlime}>
                  <Slime drop interactive />
                </span>{" "}
                <Words text="Timely" from={3} />
              </span>
              <span className={styles.titleLine}>
                <Words text="Твой AI-друг для учёбы" from={4} />
              </span>
            </h1>

            <p className={`${styles.lead} ${styles.intro}`} style={{ "--d": "700ms" } as CSSProperties}>
              Расскажи, что задали, — Timely разложит домашку на понятные шаги, объяснит
              сложную тему по твоему учебнику и поможет проверить решение.
            </p>

            <div className={styles.intro} style={{ "--d": "850ms" } as CSSProperties}>
              <HeroPrompt />
            </div>
          </div>
        </ScrollFx>

        <section className={`${styles.section} ${styles.manifesto}`}>
          <div className={styles.container}>
            <ScrollFx mode="through" className={styles.manifestoText}>
              <p>
                {MANIFESTO.split(" ").map((word, index, all) => (
                  <Fragment key={index}>
                    <span
                      className={styles.mWord}
                      style={{ "--i": index, "--n": all.length } as CSSProperties}
                    >
                      {word}
                    </span>{" "}
                  </Fragment>
                ))}
              </p>
            </ScrollFx>
          </div>
        </section>

        <section id="chat" className={styles.section}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <h2 className={styles.h2}>Обычный чат, после которого тема понятна</h2>
              <p className={styles.sub}>
                Пиши как другу. Timely уточнит, что именно непонятно, объяснит по шагам
                и проверит, что ты разобрался.
              </p>
            </Reveal>

            <ScrollFx mode="enter" end={0.15} className={styles.tiltStage}>
              <div className={styles.tilt}>
                <ChatDemo />
              </div>
            </ScrollFx>

            <div className={styles.features}>
              {FEATURES.map(({ icon: Icon, tint, title, text }, index) => (
                <Reveal key={title} delay={index * 90}>
                  <span className={`${styles.featureIcon} ${TINT[tint]}`}>
                    <Icon size={19} strokeWidth={1.9} />
                  </span>
                  <h3 className={styles.featureTitle}>{title}</h3>
                  <p className={styles.featureText}>{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className={styles.section}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <h2 className={styles.h2}>Как Timely помогает каждый день</h2>
              <p className={styles.sub}>
                От одного вопроса до подготовки к четвертной — вот как Timely встраивается
                в учёбу.
              </p>
            </Reveal>
            <UseCases />
          </div>
        </section>

        <section id="subjects" className={`${styles.section} ${styles.band}`}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <p className={styles.eyebrow}>Предметы</p>
              <h2 className={styles.h2}>Все школьные предметы в одном месте</h2>
              <p className={styles.sub}>
                Алгебра, физика, языки, история — тьютор разбирает темы школьной программы,
                а с загруженным учебником отвечает по нему.
              </p>
            </Reveal>
          </div>

          <ScrollFx mode="through" className={styles.marquee}>
            <SubjectRow items={SUBJECTS[0]} />
            <SubjectRow items={SUBJECTS[1]} reverse />
          </ScrollFx>

          <div className={styles.container}>
            <p className={styles.moreWrap}>
              <Link href={appLink("/curriculum")} className={styles.moreLink}>
                Загрузить свой учебник
                <ArrowRight size={16} />
              </Link>
            </p>

            <div className={styles.duo}>
              <Reveal className={styles.duoCard}>
                <span className={`${styles.duoIcon} ${styles.tintLilac}`}>
                  <BookOpen size={22} strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className={styles.duoTitle}>Курс по твоему учебнику</h3>
                  <p className={styles.duoText}>
                    Загрузи PDF — Timely разберёт его на модули, темы и страницы и составит
                    программу.
                  </p>
                </div>
              </Reveal>
              <Reveal className={styles.duoCard} delay={90}>
                <span className={`${styles.duoIcon} ${styles.tintPink}`}>
                  <PenLine size={22} strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className={styles.duoTitle}>Рукописный ввод на доске</h3>
                  <p className={styles.duoText}>
                    Пиши решение от руки или вставь картинку задачи — доска распознает текст
                    и формулы.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <p className={styles.eyebrow}>Внутри Timely</p>
              <h2 className={styles.h2}>Всё для учёбы — в одном месте</h2>
            </Reveal>

            <Reveal className={styles.bentoReveal}>
              <ScrollFx mode="enter" end={0.2} className={styles.bento}>
                <article className={`${styles.bentoCard} ${styles.bentoTinted} ${styles.tintLilac} ${styles.areaA}`}>
                  <p className={styles.bigStat}>1 шаг</p>
                  <p className={styles.bentoText}>
                    вместо списка из тридцати дел. Открываешь Timely — и видно, что делать
                    сейчас.
                  </p>
                  <p className={styles.bentoFoot}>
                    <CalendarDays size={16} /> План
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.areaB}`}>
                  <p className={styles.bentoQuote}>
                    Неделя, уроки и оценки — рядом с планом, а не в отдельном приложении.
                  </p>
                  <div className={styles.grades} aria-hidden="true">
                    {["5", "4", "5", "5", "4"].map((grade, index) => (
                      <span key={index} style={{ "--i": index } as CSSProperties}>
                        {grade}
                      </span>
                    ))}
                  </div>
                  <p className={styles.bentoFoot}>
                    <NotebookPen size={16} /> Дневник
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.areaC}`}>
                  <p className={styles.bentoQuote}>
                    Темы, где были ошибки, не теряются — Timely напомнит к ним вернуться.
                  </p>
                  <ul className={styles.weak} aria-hidden="true">
                    {WEAK_TOPICS.map(([topic, value], index) => (
                      <li key={topic}>
                        <span>{topic}</span>
                        <span className={styles.meter}>
                          <span style={{ "--v": `${value}%`, "--i": index } as CSSProperties} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.bentoFoot}>
                    <Target size={16} /> Слабые темы
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.bentoDark} ${styles.areaD}`}>
                  <BoardSketch tone="dark" className={styles.darkSketch} />
                  <div className={styles.darkCaption}>
                    <p className={styles.darkTitle}>
                      Схемы, графики и формулы строятся точно: AI описывает смысл, а координаты
                      считает Timely.
                    </p>
                    <p className={styles.bentoFoot}>
                      <PenTool size={16} /> Научная доска
                    </p>
                  </div>
                </article>

                <article className={`${styles.bentoCard} ${styles.bentoTinted} ${styles.tintSky} ${styles.areaE}`}>
                  <div className={styles.ring} aria-hidden="true">
                    <svg viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="50" className={styles.ringTrack} />
                      <circle cx="60" cy="60" r="50" className={styles.ringValue} pathLength={1} />
                    </svg>
                    <span>Фокус</span>
                  </div>
                  <p className={styles.bentoText}>Фокус-сессии и время учёбы — таймер всегда под рукой.</p>
                  <p className={styles.bentoFoot}>
                    <Timer size={16} /> Помодоро
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.areaF}`}>
                  <p className={styles.bentoQuote}>
                    Практика по пройденной теме, чтобы закрепить, а не просто прочитать.
                  </p>
                  <p className={styles.bentoFoot}>
                    <Dumbbell size={16} /> Самостоятельная
                  </p>
                </article>
              </ScrollFx>
            </Reveal>
          </div>
        </section>

        <section id="faq" className={styles.section}>
          <div className={`${styles.container} ${styles.faqGrid}`}>
            <Reveal className={styles.faqAside}>
              <span className={styles.faqGlow} aria-hidden="true" />
              <p className={styles.eyebrow}>Вопросы</p>
              <h2 className={styles.h2}>Частые вопросы</h2>
              <p className={styles.faqSub}>Коротко о том, как устроен Timely и с чего начать.</p>
            </Reveal>
            <Reveal delay={90}>
              <Faq />
            </Reveal>
          </div>
        </section>

        <section className={styles.ctaSection}>
          <div className={styles.container}>
            <Reveal>
              <ScrollFx mode="enter" end={0.45} className={styles.cta}>
                <div className={styles.ctaText}>
                  <h2 className={styles.ctaTitle}>Начни с одного вопроса</h2>
                  <p className={styles.ctaSub}>
                    Расскажи, что задали на завтра, и посмотри, как Timely разложит это на шаги.
                  </p>
                  <div className={styles.ctaActions}>
                    <Link href={appLink()} className={styles.darkButton}>
                      Открыть Timely
                    </Link>
                    <Link href={appLink("/auth/register")} className={styles.lightButton}>
                      Создать аккаунт
                    </Link>
                  </div>
                </div>
                <div className={styles.ctaSlime}>
                  <div className={styles.ctaLift}>
                    <Slime interactive label="Слайм Timely. Нажми — подпрыгнет" />
                  </div>
                </div>
              </ScrollFx>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerGrid}`}>
          <div>
            <Link href="/" className={styles.footerBrand}>
              <LogoMark size={34} />
              Timely
            </Link>
            <p className={styles.footerNote}>Учебное пространство для школьников.</p>
          </div>
          {FOOTER.map((column) => (
            <div key={column.title}>
              <p className={styles.footerTitle}>{column.title}</p>
              <ul className={styles.footerLinks}>
                {column.links.map(([label, path]) => (
                  <li key={label}>
                    <Link href={appLink(path)}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <span>© {new Date().getFullYear()} Timely</span>
        </div>
      </footer>
    </div>
  );
}
